// pdfjs-dist's legacy Node build (used by pdf-parse) runs `new DOMMatrix()` at
// module-evaluation time to build a shared scale matrix. Node has no DOMMatrix
// global and @napi-rs/canvas isn't installed, so importing pdf-parse crashes
// the entire module with "ReferenceError: DOMMatrix is not defined" unless a
// global is present before pdf-parse is imported. These polyfills are only
// needed to satisfy that module-load-time reference — text extraction
// (getText) never exercises the canvas rendering paths that use them.

if (typeof globalThis.DOMMatrix === 'undefined') {
  class DOMMatrixPolyfill {
    a = 1
    b = 0
    c = 0
    d = 1
    e = 0
    f = 0

    constructor(init?: number[]) {
      if (init && init.length === 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init
      }
    }

    multiply(other: DOMMatrixPolyfill) {
      return new DOMMatrixPolyfill([
        this.a * other.a + this.c * other.b,
        this.b * other.a + this.d * other.b,
        this.a * other.c + this.c * other.d,
        this.b * other.c + this.d * other.d,
        this.a * other.e + this.c * other.f + this.e,
        this.b * other.e + this.d * other.f + this.f,
      ])
    }

    multiplySelf(other: DOMMatrixPolyfill) {
      return Object.assign(this, this.multiply(other))
    }

    preMultiplySelf(other: DOMMatrixPolyfill) {
      return Object.assign(this, other.multiply(this))
    }

    translate(tx = 0, ty = 0) {
      return this.multiply(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty]))
    }

    scale(sx = 1, sy = sx) {
      return this.multiply(new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0]))
    }

    invertSelf() {
      const det = this.a * this.d - this.b * this.c
      const { a, b, c, d, e, f } = this
      this.a = d / det
      this.b = -b / det
      this.c = -c / det
      this.d = a / det
      this.e = (c * f - d * e) / det
      this.f = (b * e - a * f) / det
      return this
    }
  }

  globalThis.DOMMatrix = DOMMatrixPolyfill as unknown as typeof DOMMatrix
}

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    data: Uint8ClampedArray
    width: number
    height: number

    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data
      this.width = width
      this.height = height ?? data.length / (4 * width)
    }
  }

  globalThis.ImageData = ImageDataPolyfill as unknown as typeof ImageData
}

if (typeof globalThis.Path2D === 'undefined') {
  class Path2DPolyfill {
    addPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    rect() {}
    arc() {}
    ellipse() {}
  }

  globalThis.Path2D = Path2DPolyfill as unknown as typeof Path2D
}
