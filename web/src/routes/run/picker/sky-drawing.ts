import { Data, Effect, Result } from 'effect'

import type { SkyPosition } from '../../../../../state/sky-cut.ts'
import { meshCells, meshTriangles, tileMesh, tilesInView } from '../../../../../state/sky-mesh.ts'
import { tileFile, type Survey } from '../../../../../state/survey.ts'

export interface SkyLayer {
  readonly survey: Survey
  readonly tilesPath: string
}

export interface SkyView {
  readonly eastDegrees: number
  readonly northDegrees: number
  readonly degreesPerPixel: number
  readonly widthPixels: number
  readonly heightPixels: number
  readonly layers: ReadonlyArray<SkyLayer>
}

export interface SkyDrawing {
  readonly show: (view: SkyView) => void
  readonly close: () => void
}

export class SkyUndrawable extends Data.TaggedError('SkyUndrawable')<{ readonly reason: string }> {}

class TileUnloadable extends Data.TaggedError('TileUnloadable')<{ readonly address: string; readonly reason: string }> {}

interface Mesh {
  readonly corners: WebGLVertexArrayObject
  readonly places: WebGLBuffer
}

const vertexSource = `#version 300 es
in vec2 plane;
in vec2 texel;
uniform vec2 centre;
uniform vec2 perDegree;
out vec2 at;

void main() {
  at = texel;
  gl_Position = vec4((plane - centre) * perDegree, 0.0, 1.0);
}`

const fragmentSource = `#version 300 es
precision mediump float;
in vec2 at;
uniform sampler2D tile;
out vec4 colour;

void main() {
  colour = texture(tile, at);
}`

const planeAttribute = 0
const texelAttribute = 1
const floatsPerCorner = 4
const bytesPerFloat = 4

const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const bitmapAt = (address: string): Effect.Effect<ImageBitmap, TileUnloadable> =>
  Effect.tryPromise({ try: () => fetch(address), catch: cause => new TileUnloadable({ address, reason: reasonOf(cause) }) }).pipe(
    Effect.flatMap(answer =>
      answer.ok
        ? Effect.tryPromise({ try: async () => createImageBitmap(await answer.blob()), catch: cause => new TileUnloadable({ address, reason: reasonOf(cause) }) })
        : Effect.fail(new TileUnloadable({ address, reason: `HTTP ${answer.status}` })),
    ),
  )

function shaderOf(gl: WebGL2RenderingContext, kind: number, source: string): Result.Result<WebGLShader, SkyUndrawable> {
  const shader = gl.createShader(kind)

  if (shader === null) return Result.fail(new SkyUndrawable({ reason: 'the browser gave no shader' }))

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true ? Result.succeed(shader) : Result.fail(new SkyUndrawable({ reason: gl.getShaderInfoLog(shader) ?? 'a shader did not compile' }))
}

function programOf(gl: WebGL2RenderingContext): Result.Result<WebGLProgram, SkyUndrawable> {
  const vertex = shaderOf(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = shaderOf(gl, gl.FRAGMENT_SHADER, fragmentSource)

  if (Result.isFailure(vertex)) return Result.fail(vertex.failure)
  if (Result.isFailure(fragment)) return Result.fail(fragment.failure)

  const program = gl.createProgram()

  gl.attachShader(program, vertex.success)
  gl.attachShader(program, fragment.success)
  gl.bindAttribLocation(program, planeAttribute, 'plane')
  gl.bindAttribLocation(program, texelAttribute, 'texel')
  gl.linkProgram(program)

  return gl.getProgramParameter(program, gl.LINK_STATUS) === true ? Result.succeed(program) : Result.fail(new SkyUndrawable({ reason: gl.getProgramInfoLog(program) ?? 'the shaders did not link' }))
}

export function makeSkyDrawing(canvas: HTMLCanvasElement, centre: SkyPosition, onMissing: (tiles: number) => void): Result.Result<SkyDrawing, SkyUndrawable> {
  const gl = canvas.getContext('webgl2')

  if (gl === null) return Result.fail(new SkyUndrawable({ reason: 'this browser has no WebGL2' }))

  const linked = programOf(gl)

  if (Result.isFailure(linked)) return Result.fail(linked.failure)

  const program = linked.success
  const centreAt = gl.getUniformLocation(program, 'centre')
  const perDegreeAt = gl.getUniformLocation(program, 'perDegree')
  const triangles = gl.createBuffer()
  const triangleCorners = meshTriangles(meshCells)
  const meshes = new Map<string, Mesh>()
  const textures = new Map<string, WebGLTexture>()
  const missing = new Set<string>()
  let shown: SkyView | undefined
  let inView: ReadonlyArray<string> = []
  let open = true

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triangles)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, triangleCorners, gl.STATIC_DRAW)
  gl.clearColor(0, 0, 0, 0)

  const keyOf = (layer: SkyLayer, tile: number) => `${layer.tilesPath}/${tileFile(layer.survey.order, tile)}`

  const neededBy = (view: SkyView, layer: SkyLayer) =>
    tilesInView(centre, { eastDegrees: view.eastDegrees, northDegrees: view.northDegrees, widthDegrees: view.widthPixels * view.degreesPerPixel, heightDegrees: view.heightPixels * view.degreesPerPixel }, layer.survey.order)

  const meshOf = (layer: SkyLayer, tile: number): Mesh => {
    const corners = gl.createVertexArray()
    const places = gl.createBuffer()

    gl.bindVertexArray(corners)
    gl.bindBuffer(gl.ARRAY_BUFFER, places)
    gl.bufferData(gl.ARRAY_BUFFER, tileMesh(centre, layer.survey.order, tile, meshCells), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(planeAttribute)
    gl.vertexAttribPointer(planeAttribute, 2, gl.FLOAT, false, floatsPerCorner * bytesPerFloat, 0)
    gl.enableVertexAttribArray(texelAttribute)
    gl.vertexAttribPointer(texelAttribute, 2, gl.FLOAT, false, floatsPerCorner * bytesPerFloat, 2 * bytesPerFloat)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triangles)
    gl.bindVertexArray(null)

    return { corners, places }
  }

  const draw = () => {
    if (shown === undefined) return

    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program)
    gl.uniform2f(centreAt, shown.eastDegrees, shown.northDegrees)
    gl.uniform2f(perDegreeAt, -2 / (shown.degreesPerPixel * shown.widthPixels), 2 / (shown.degreesPerPixel * shown.heightPixels))

    for (const key of inView) {
      const mesh = meshes.get(key)
      const texture = textures.get(key)

      if (mesh === undefined || texture === undefined) continue

      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.bindVertexArray(mesh.corners)
      gl.drawElements(gl.TRIANGLES, triangleCorners.length, gl.UNSIGNED_SHORT, 0)
    }

    gl.bindVertexArray(null)
  }

  const place = (key: string, mesh: Mesh, bitmap: ImageBitmap) => {
    if (open && meshes.get(key) === mesh) {
      const texture = gl.createTexture()

      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      textures.set(key, texture)
      draw()
    }

    bitmap.close()
  }

  const miss = (key: string, mesh: Mesh) => {
    if (!open || meshes.get(key) !== mesh) return

    missing.add(key)
    onMissing(missing.size)
  }

  const drop = (key: string, mesh: Mesh) => {
    const texture = textures.get(key)

    if (texture !== undefined) gl.deleteTexture(texture)

    gl.deleteVertexArray(mesh.corners)
    gl.deleteBuffer(mesh.places)
    textures.delete(key)
    meshes.delete(key)

    if (missing.delete(key) && open) onMissing(missing.size)
  }

  const load = (layer: SkyLayer, tile: number, key: string) => {
    const mesh = meshOf(layer, tile)

    meshes.set(key, mesh)
    Effect.runFork(
      bitmapAt(key).pipe(
        Effect.map(bitmap => place(key, mesh, bitmap)),
        Effect.catchTag('TileUnloadable', () => Effect.sync(() => miss(key, mesh))),
      ),
    )
  }

  return Result.succeed({
    show: view => {
      const pixels = window.devicePixelRatio
      const width = Math.round(view.widthPixels * pixels)
      const height = Math.round(view.heightPixels * pixels)

      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height

      shown = view
      inView = view.layers.flatMap(layer =>
        neededBy(view, layer).map(tile => {
          const key = keyOf(layer, tile)

          if (!meshes.has(key)) load(layer, tile, key)

          return key
        }),
      )

      const needed = new Set(inView)

      for (const [key, mesh] of [...meshes]) if (!needed.has(key)) drop(key, mesh)

      draw()
    },
    close: () => {
      open = false

      for (const [key, mesh] of [...meshes]) drop(key, mesh)

      gl.deleteBuffer(triangles)
      gl.deleteProgram(program)
    },
  })
}
