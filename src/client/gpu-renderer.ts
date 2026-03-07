import { type RasterImageData, createRasterImageData } from "../shared/mandelbrot";
import type { ViewportState } from "../shared/viewport";

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

uniform vec2 u_center;
uniform float u_zoom;
uniform vec2 u_resolution;
uniform float u_maxIterations;

vec3 getColor(float value) {
  if (value < 0.0) {
    return vec3(0.0, 0.0, 0.0);
  }

  float normalized = clamp(value / 50.0, 0.0, 1.0);
  return vec3(
    9.0 * (1.0 - normalized) * normalized * normalized * normalized,
    15.0 * pow(1.0 - normalized, 2.0) * normalized * normalized,
    8.5 * pow(1.0 - normalized, 3.0) * normalized
  );
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  float planeWidth = 4.0 / u_zoom;
  float planeHeight = planeWidth / aspect;

  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, 1.0 - (gl_FragCoord.y / u_resolution.y));
  vec2 c = vec2(
    u_center.x - planeWidth * 0.5 + uv.x * planeWidth,
    u_center.y - planeHeight * 0.5 + uv.y * planeHeight
  );

  float q = (c.x - 0.25) * (c.x - 0.25) + c.y * c.y;
  if (q * (q + (c.x - 0.25)) <= 0.25 * c.y * c.y) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  if ((c.x + 1.0) * (c.x + 1.0) + c.y * c.y <= 0.0625) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 z = vec2(0.0, 0.0);
  float iteration = u_maxIterations;

  for (int i = 0; i < 2048; i++) {
    if (float(i) >= u_maxIterations) {
      break;
    }

    float x = z.x * z.x - z.y * z.y + c.x;
    float y = 2.0 * z.x * z.y + c.y;
    z = vec2(x, y);

    if (dot(z, z) > 4.0) {
      float logMagnitude = log(dot(z, z)) / 2.0;
      iteration = float(i) + 1.0 - log(logMagnitude / log(2.0)) / log(2.0);
      break;
    }
  }

  gl_FragColor = vec4(getColor(iteration), 1.0);
}
`;

/**
 * Flip WebGL readback rows into top-left origin RGBA data.
 */
export function flipRgbaRows(pixels: Uint8ClampedArray, width: number, height: number) {
  const stride = width * 4;
  const flipped = new Uint8ClampedArray(pixels.length);

  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * stride;
    const targetOffset = (height - row - 1) * stride;
    flipped.set(pixels.subarray(sourceOffset, sourceOffset + stride), targetOffset);
  }

  return flipped;
}

/**
 * WebGL Mandelbrot renderer used for exact full-resolution frames when available.
 */
export class GpuFractalRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #gl: WebGLRenderingContext | null;
  readonly #positionBuffer: WebGLBuffer | null;
  readonly #program: WebGLProgram | null;
  readonly #uniformLocations: {
    readonly center: WebGLUniformLocation | null;
    readonly maxIterations: WebGLUniformLocation | null;
    readonly resolution: WebGLUniformLocation | null;
    readonly zoom: WebGLUniformLocation | null;
  } | null;

  constructor() {
    this.#canvas = document.createElement("canvas");
    this.#gl =
      this.#canvas.getContext("webgl", {
        antialias: false,
        depth: false,
        preserveDrawingBuffer: true,
        stencil: false,
      }) ?? null;

    if (!this.#gl) {
      this.#positionBuffer = null;
      this.#program = null;
      this.#uniformLocations = null;
      return;
    }

    const program = createProgram(this.#gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    if (!program) {
      this.#positionBuffer = null;
      this.#program = null;
      this.#uniformLocations = null;
      return;
    }

    const positionBuffer = this.#gl.createBuffer();
    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, positionBuffer);
    this.#gl.bufferData(
      this.#gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      this.#gl.STATIC_DRAW,
    );

    const attributeLocation = this.#gl.getAttribLocation(program, "a_position");
    this.#gl.enableVertexAttribArray(attributeLocation);
    this.#gl.vertexAttribPointer(attributeLocation, 2, this.#gl.FLOAT, false, 0, 0);

    this.#positionBuffer = positionBuffer;
    this.#program = program;
    this.#uniformLocations = {
      center: this.#gl.getUniformLocation(program, "u_center"),
      maxIterations: this.#gl.getUniformLocation(program, "u_maxIterations"),
      resolution: this.#gl.getUniformLocation(program, "u_resolution"),
      zoom: this.#gl.getUniformLocation(program, "u_zoom"),
    };
  }

  /**
   * Return whether GPU rendering is available.
   */
  get isAvailable() {
    return Boolean(this.#gl && this.#program && this.#uniformLocations && this.#positionBuffer);
  }

  /**
   * Render the requested viewport to RGBA image data using WebGL.
   */
  render(viewport: ViewportState, maxIterations: number): RasterImageData | null {
    if (!this.#gl || !this.#program || !this.#uniformLocations) {
      return null;
    }

    this.#canvas.width = viewport.width;
    this.#canvas.height = viewport.height;
    this.#gl.viewport(0, 0, viewport.width, viewport.height);
    this.#gl.useProgram(this.#program);
    this.#gl.uniform2f(this.#uniformLocations.center, viewport.centerX, viewport.centerY);
    this.#gl.uniform1f(this.#uniformLocations.zoom, viewport.zoom);
    this.#gl.uniform2f(this.#uniformLocations.resolution, viewport.width, viewport.height);
    this.#gl.uniform1f(this.#uniformLocations.maxIterations, maxIterations);
    this.#gl.drawArrays(this.#gl.TRIANGLE_STRIP, 0, 4);

    const pixels = new Uint8Array(viewport.width * viewport.height * 4);
    this.#gl.readPixels(
      0,
      0,
      viewport.width,
      viewport.height,
      this.#gl.RGBA,
      this.#gl.UNSIGNED_BYTE,
      pixels,
    );

    return createRasterImageData(
      flipRgbaRows(new Uint8ClampedArray(pixels.buffer), viewport.width, viewport.height),
      viewport.width,
      viewport.height,
    );
  }
}

/**
 * Create and link a WebGL program from source strings.
 */
function createProgram(
  gl: WebGLRenderingContext,
  vertexShaderSource: string,
  fragmentShaderSource: string,
) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

  if (!vertexShader || !fragmentShader) {
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

/**
 * Compile a single WebGL shader.
 */
function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}
