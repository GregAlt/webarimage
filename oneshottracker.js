import * as THREE from 'three';
import jsQR from 'jsqr';

export function createOneShotTracker(renderer, physicalWidthMeters) {
  let glBinding = null;
  let readbackFbo = null;
  let lastScanTime = 0;

  function computeQRWorldMatrix(location, width, height, view) {
    const p = view.projectionMatrix;
    const fx = (p[0] * width) / 2;
    const fy = (p[5] * height) / 2;
    const cx = ((1 - p[8]) * width) / 2;
    const cy = ((1 + p[9]) * height) / 2;

    const {
      topLeftCorner: tl,
      topRightCorner: tr,
      bottomRightCorner: br,
      bottomLeftCorner: bl,
    } = location;

    const topPx = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const bottomPx = Math.hypot(br.x - bl.x, br.y - bl.y);
    const leftPx = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const rightPx = Math.hypot(br.x - tr.x, br.y - tr.y);
    const avgPx = (topPx + bottomPx + leftPx + rightPx) / 4;

    const depth = (fx * physicalWidthMeters) / avgPx;

    const centerX = (tl.x + tr.x + br.x + bl.x) / 4;
    const centerY = (tl.y + tr.y + br.y + bl.y) / 4;
    const posCam = new THREE.Vector3(
      ((centerX - cx) / fx) * depth,
      -((centerY - cy) / fy) * depth,
      -depth
    );

    const right2D = new THREE.Vector2(
      (tr.x + br.x) / 2 - (tl.x + bl.x) / 2,
      -((tr.y + br.y) / 2 - (tl.y + bl.y) / 2)
    ).normalize();

    const up2D = new THREE.Vector2(
      (tl.x + tr.x) / 2 - (bl.x + br.x) / 2,
      -((tl.y + tr.y) / 2 - (bl.y + br.y) / 2)
    ).normalize();

    const horizScale = Math.min(1, ((topPx + bottomPx) / 2) / avgPx);
    const vertScale = Math.min(1, ((leftPx + rightPx) / 2) / avgPx);
    const yaw = Math.acos(horizScale) * Math.sign(rightPx - leftPx);
    const pitch = Math.acos(vertScale) * Math.sign(topPx - bottomPx);

    // Match WebXR imageSpace basis (+X right, +Y surface normal out of poster, +Z down)
    // Note: I found this instead! (+X down, +Y out, +Z left) -- due to portrait/landscape camera conventions
    const zAxis = new THREE.Vector3(right2D.x, right2D.y, Math.sin(yaw)).normalize().negate();
    const xAxis = new THREE.Vector3(-up2D.x, -up2D.y, Math.sin(pitch)).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    zAxis.crossVectors(xAxis, yAxis).normalize();

    const localMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    localMatrix.setPosition(posCam);

    const camWorldMatrix = new THREE.Matrix4().fromArray(view.transform.matrix);
    return camWorldMatrix.multiply(localMatrix);
  }

  return {
    init(session) {
      if (session.enabledFeatures?.includes('camera-access')) {
        glBinding = new XRWebGLBinding(session, renderer.getContext());
      }
    },

    reset() {
      glBinding = null;
      readbackFbo = null;
      lastScanTime = 0;
    },

    // Returns a THREE.Matrix4 when the QR code is detected, or null otherwise
    detect(time, frame, referenceSpace) {
      if (!glBinding || time - lastScanTime < 250) return null;
      lastScanTime = time;

      const pose = frame.getViewerPose(referenceSpace);
      const view = pose?.views[0];
      if (!view?.camera) return null;

      const gl = renderer.getContext();
      const camTexture = glBinding.getCameraImage(view.camera);
      if (!camTexture) return null;

      const { width, height } = view.camera;
      if (!readbackFbo) readbackFbo = gl.createFramebuffer();

      const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.FRAMEBUFFER, readbackFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, camTexture, 0);

      const pixels = new Uint8ClampedArray(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);

      // Flip rows vertically (WebGL readPixels is bottom-up)
      const flipped = new Uint8ClampedArray(pixels.length);
      const rowBytes = width * 4;
      for (let y = 0; y < height; y++) {
        flipped.set(
          pixels.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes),
          y * rowBytes
        );
      }

      const code = jsQR(flipped, width, height, { inversionAttempts: 'dontInvert' });
      return code ? computeQRWorldMatrix(code.location, width, height, view) : null;
    },
  };
}
