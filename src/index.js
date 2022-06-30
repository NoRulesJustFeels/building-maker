import './styles.css'

import * as BABYLON from '@babylonjs/core'
import * as GUI from '@babylonjs/gui/2D'
import { GridMaterial } from '@babylonjs/materials/grid'
import { SkyMaterial } from '@babylonjs/materials/sky'
import { GLTF2Export } from '@babylonjs/serializers/glTF'
import axios from 'axios'
import earcut from 'earcut'
import * as pointInPolygon from 'point-in-polygon'

const DEFAULT_PLACE_ID = '1'

let placeId = DEFAULT_PLACE_ID
let style = 1
let storeys = false
let scene
let camera
let material
let place
let placeMetadata
let floor
let maxRectangle
let buildingMaterial
let glassMaterial
let buildingMesh
let windows = []
let trianglesText
let showGrid = true
let showSky = true
let showRectangularFloor = false

const DEFAULT_COLOR = BABYLON.Color3.Random()
const DEFAULT_TRIANGLES_TEXT = 'Triangles: 0'

const canvas = document.getElementById('renderCanvas')
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })

const createScene = () => {
  scene = new BABYLON.Scene(engine)

  camera = new BABYLON.ArcRotateCamera('camera', BABYLON.Tools.ToRadians(90), BABYLON.Tools.ToRadians(85), 10, BABYLON.Vector3.Zero(), scene)
  camera.setTarget(BABYLON.Vector3.Zero())
  camera.attachControl(canvas, false)
  camera.useFramingBehavior = true

  // Create a basic light, aiming 0, 1, 0 - meaning, to the sky
  let light1 = new BABYLON.HemisphericLight('light1', new BABYLON.Vector3(0, 1, 0), scene)
  // Add a light to reflect the windows
  let light2 = new BABYLON.DirectionalLight("light2", new BABYLON.Vector3(1, 0, -100), scene)
  light2.intensity = 0.1

  // https://doc.babylonjs.com/toolsAndResources/assetLibraries/materialsLibrary/skyMat
  if (showSky) {
    const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000 }, scene)
    const skyMaterial = new SkyMaterial("skyMaterial", scene)
    skyMaterial.backFaceCulling = false
    skyMaterial.inclination = 0 // Day
    skyMaterial.turbidity = 100
    skyMaterial.luminance = 1
    skybox.material = skyMaterial
  }

  // Building materials
  buildingMaterial = new BABYLON.PBRMetallicRoughnessMaterial('building', scene)
  buildingMaterial.baseColor = DEFAULT_COLOR
  buildingMaterial.metallic = 0.2
  buildingMaterial.roughness = 1.0

  // Glass material
  glassMaterial = new BABYLON.PBRMetallicRoughnessMaterial('glass', scene)
  glassMaterial.baseColor = new BABYLON.Color3(0.78, 0.82, 0.85)
  glassMaterial.emissiveColor = new BABYLON.Color3(0.46, 0.48, 0.5)
  glassMaterial.metallic = 1.0
  glassMaterial.roughness = 0.1
  glassMaterial.alpha = 0.1
}

// https://doc.babylonjs.com/divingDeeper/gui/gui
// https://doc.babylonjs.com/typedoc/classes/BABYLON.GUI.Control
const buildGui = () => {
  engine.setHardwareScalingLevel(1 / window.devicePixelRatio)

  const advancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI', undefined, undefined, BABYLON.Texture.NEAREST_NEAREST)
  //advancedTexture.rootContainer.scaleX = window.devicePixelRatio // Results in GUI going off-screen for me
  //advancedTexture.rootContainer.scaleY = window.devicePixelRatio

  // Text style
  const textStyle = advancedTexture.createStyle()
  textStyle.fontSize = 20
  textStyle.fontStyle = 'bold'

  const PADDING = '10px'

  // Add a rectangle for behind the UI elements
  const guiRect = new GUI.Rectangle()
  guiRect.adaptWidthToChildren = true
  guiRect.width = '220px'
  guiRect.height = '580px'
  guiRect.cornerRadius = 10
  guiRect.color = 'Orange'
  guiRect.thickness = 2
  guiRect.background = 'black'
  guiRect.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT
  guiRect.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP
  guiRect.top = '0px'
  guiRect.left = '0px'
  guiRect.paddingRight = '1px'
  advancedTexture.addControl(guiRect)

  // Stack the UI elements vertically
  const panel = new GUI.StackPanel()
  panel.width = '200px'
  panel.isVertical = true
  panel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT
  panel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP
  advancedTexture.addControl(panel)

  // Let the user enter the tz1and place ID
  const placeIdText = new GUI.TextBlock()
  placeIdText.text = 'Change place ID'
  placeIdText.color = 'white'
  placeIdText.height = '40px'
  placeIdText.style = textStyle
  placeIdText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
  placeIdText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM
  panel.addControl(placeIdText)

  const placeIdInput = new GUI.InputText()
  placeIdInput.width = 0.4
  placeIdInput.maxWidth = 0.2
  placeIdInput.height = '40px'
  placeIdInput.text = placeId
  placeIdInput.color = 'white'
  placeIdInput.style = textStyle
  placeIdInput.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
  placeIdInput.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM
  placeIdInput.paddingBottom = PADDING
  // Numeric input only
  placeIdInput.onBeforeKeyAddObservable.add((input) => {
    let key = input.currentKey
    const parsed = parseInt(key)
    input.addKey = !isNaN(parsed)
  })
  placeIdInput.onBlurObservable.add(async (input) => {
    console.log('place id', input.text)
    await update(input.text)
  })
  panel.addControl(placeIdInput)

  // Let the user change the building color
  const colorText = new GUI.TextBlock()
  colorText.text = 'Change color'
  colorText.color = 'white'
  colorText.height = '40px'
  colorText.style = textStyle
  colorText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
  colorText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM
  panel.addControl(colorText)

  const colorPicker = new GUI.ColorPicker()
  colorPicker.value = material ? material.diffuseColor : DEFAULT_COLOR
  colorPicker.height = '150px'
  colorPicker.width = '150px'
  colorPicker.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
  colorPicker.onValueChangedObservable.add((value) => {
    buildingMaterial.baseColor.copyFrom(value)
    buildingMaterial.baseColor.copyFrom(value)
    buildingMaterial.baseColor.copyFrom(value)
  })
  colorPicker.paddingBottom = PADDING

  panel.addControl(colorPicker)

  // Let the user pick from 4 styles
  const styleText = new GUI.TextBlock()
  styleText.text = 'Change style'
  styleText.color = 'white'
  styleText.height = '40px'
  styleText.style = textStyle
  styleText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
  styleText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM
  panel.addControl(styleText)

  const STYLE_1 = 'Style 1'
  const STYLE_2 = 'Style 2'
  const STYLE_3 = 'Style 3'
  const STYLE_4 = 'Style 4'
  const addStyleRadio = (text, parent, checked) => {
    const button = new GUI.RadioButton()
    button.isChecked = checked
    button.width = '20px'
    button.height = '20px'
    button.color = 'white'
    button.background = 'black'
    button.style = textStyle
    button.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
    button.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP
    button.group = 'style'

    button.onIsCheckedChangedObservable.add(async (state) => {
      if (state) {
        console.log(text)
        switch (text) {
          case STYLE_1:
            style = 1
            break
          case STYLE_2:
            style = 2
            break
          case STYLE_3:
            style = 3
            break
          case STYLE_4:
            style = 4
            break

          default:
            style = 1
            break
        }
        await update()
      }
    })

    const header = GUI.Control.AddHeader(button, text, '180px', { isHorizontal: true, controlFirst: true })
    header.height = '30px'
    header.color = 'white'
    header.style = textStyle
    header.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
    header.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM
    header.paddingBottom = PADDING

    parent.addControl(header)
  }

  addStyleRadio(STYLE_1, panel, true)
  addStyleRadio(STYLE_2, panel, false)
  addStyleRadio(STYLE_3, panel, false)
  addStyleRadio(STYLE_4, panel, false)

  // Let the user decide if the building is single or multi-storey
  const storeysText = new GUI.TextBlock()
  storeysText.text = 'Change storeys'
  storeysText.color = 'white'
  storeysText.height = '40px'
  storeysText.style = textStyle
  storeysText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
  storeysText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM
  panel.addControl(storeysText)

  const STOREY_SINGLE = 'Single'
  const STOREY_MULTIPLE = 'Multiple'
  const addStoreyRadio = (text, parent, checked) => {
    const button = new GUI.RadioButton()
    button.isChecked = checked
    button.width = '20px'
    button.height = '20px'
    button.color = 'white'
    button.background = 'black'
    button.style = textStyle
    button.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
    button.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP
    button.group = 'storey'

    button.onIsCheckedChangedObservable.add(async (state) => {
      if (state) {
        console.log(text)
        switch (text) {
          case STOREY_SINGLE:
            storeys = false
            break
          case STOREY_MULTIPLE:
            storeys = true
            break

          default:
            storeys = false
            break
        }
        await update()
      }
    })

    const header = GUI.Control.AddHeader(button, text, '180px', { isHorizontal: true, controlFirst: true })
    header.height = '30px'
    header.color = 'white'
    header.style = textStyle
    header.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
    header.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM
    header.paddingBottom = PADDING

    parent.addControl(header)
  }

  addStoreyRadio(STOREY_SINGLE, panel, true)
  addStoreyRadio(STOREY_MULTIPLE, panel, false)

  // Provide a button to download the building as a .glb file
  const downloadButton = GUI.Button.CreateSimpleButton('button', 'Download .glb')
  downloadButton.width = 0.8
  downloadButton.height = '40px'
  downloadButton.color = 'white'
  downloadButton.background = 'green'
  downloadButton.style = textStyle
  downloadButton.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
  downloadButton.paddingTop = PADDING
  downloadButton.onPointerClickObservable.add((state) => {
    console.log('download')
    let options = {
      shouldExportNode: function (node) {
        // Exclude the camera, light and place boundary from the export
        return node === buildingMesh
      },
    }
    // https://doc.babylonjs.com/extensions/glTFExporter
    GLTF2Export.GLBAsync(scene, `building-${placeId}`, options).then((glb) => {
      glb.downloadFiles()
    })
  })
  panel.addControl(downloadButton)

  trianglesText = new GUI.TextBlock()
  trianglesText.text = DEFAULT_TRIANGLES_TEXT
  trianglesText.color = 'white'
  trianglesText.height = '40px'
  trianglesText.style = textStyle
  trianglesText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
  trianglesText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM
  trianglesText.paddingLeft = PADDING
  advancedTexture.addControl(trianglesText)
  trianglesText.isVisible = false  // hide for now; triangle count not accurate

  // https://doc.babylonjs.com/toolsAndResources/assetLibraries/materialsLibrary/gridMat
  if (showGrid) {
    const ground = BABYLON.MeshBuilder.CreateGround("ground", { height: 1000, width: 1000 })
    let gridMaterial = new GridMaterial("grid", scene)
    gridMaterial.backFaceCulling = false
    gridMaterial.opacity = 0.55
    gridMaterial.majorUnitFrequency = 10
    gridMaterial.gridRatio = 1
    gridMaterial.useMaxLine = true
    ground.material = gridMaterial
  }
}

const removeMesh = (mesh) => {
  if (mesh) {
    mesh.dispose()
    scene.removeMesh(mesh)
  }
}

// Create a transparent bounding box for the place
const buildPlaceBounds = async () => {
  console.log('buildPlaceBounds', placeId)
  removeMesh(place)
  placeMetadata = null

  // https://api.tzkt.io/v1/tokens?contract=KT1G6bH9NVDp8tSSz7FzDUnCgbJwQikxtUog&tokenId=97
  try {
    // Get the place metadata from tz1and Places smart contract storage
    const tzktResponse = await axios.get(`https://api.tzkt.io/v1/tokens?contract=KT1G6bH9NVDp8tSSz7FzDUnCgbJwQikxtUog&tokenId=${placeId}`)
    if (tzktResponse && tzktResponse.data && tzktResponse.data.length > 0) {
      placeMetadata = tzktResponse.data[0].metadata
      // Render an extruded bounds polygon
      const shape = []
      for (let index = 0; index < placeMetadata.borderCoordinates.length; index++) {
        const coordinate = placeMetadata.borderCoordinates[index]
        shape.push(new BABYLON.Vector3(parseFloat(coordinate[0]), 0, parseFloat(coordinate[2])))
      }
    }
    if (!placeMetadata) {
      console.error(`Place ${placeId} does not exist`)
    }
  } catch (error) {
    console.error(error)
  }
}

const rotatePoint = (pointX, pointZ, originX, originZ, angle) => {
  angle = BABYLON.Angle.FromDegrees(angle).radians()
  return {
    x: Math.cos(angle) * (pointX - originX) - Math.sin(angle) * (pointZ - originZ) + originX,
    z: Math.sin(angle) * (pointX - originX) + Math.cos(angle) * (pointZ - originZ) + originZ
  }
}

// Find a rectangle that fits within the bounds of the place polygon (fast, but not optimal)
const calculateRectangularFloor = () => {
  console.log('calculateRectangularFloor')
  removeMesh(floor)
  maxRectangle = null

  if (placeMetadata) {
    // Find the extent of the place polygon
    let minX = Number.MAX_SAFE_INTEGER
    let minZ = Number.MAX_SAFE_INTEGER
    let maxX = -Number.MAX_SAFE_INTEGER
    let maxZ = -Number.MAX_SAFE_INTEGER
    let polygon = []
    for (let index = 0; index < placeMetadata.borderCoordinates.length; index++) {
      const coordinate = placeMetadata.borderCoordinates[index]
      const x = parseFloat(coordinate[0])
      const z = parseFloat(coordinate[2])
      polygon.push([x, z])
      if (x < minX) {
        minX = x
      }
      if (x > maxX) {
        maxX = x
      }
      if (z < minZ) {
        minZ = z
      }
      if (z > maxZ) {
        maxZ = z
      }
    }
    const centerX = 0
    const centerZ = 0

    // Arbitrary transformations for fitting a rectangle in the place boundary
    const SCALES = [1, 0.9, 1.1, 0.8, 1.2, 0.7, 1.3, 0.5, 1.5]
    const ROTATIONS = [0, BABYLON.Angle.FromDegrees(30).radians(), BABYLON.Angle.FromDegrees(60).radians(), BABYLON.Angle.FromDegrees(90).radians(), BABYLON.Angle.FromDegrees(120).radians(), BABYLON.Angle.FromDegrees(150).radians()]
    const DISPLACEMENTS = [0, 2, 4, 6, 8, 10, -2, -4, -6, -8, -10]

    // Top view dimensions
    let width = maxX / 2
    let height = maxZ / 2
    // Prefer width over height so that the door is on the wider side
    if (width < height) {
      width = maxZ / 2
      height = maxX / 2
    }

    for (let i = 0; i < SCALES.length; i++) {
      const scale = SCALES[i]
      for (let j = 0; j < DISPLACEMENTS.length; j++) {
        const displacementX = DISPLACEMENTS[j]
        for (let k = 0; k < DISPLACEMENTS.length; k++) {
          const displacementZ = DISPLACEMENTS[k]
          for (let l = 0; l < ROTATIONS.length; l++) {
            const rotation = ROTATIONS[l]

            const widthScale = (width * scale)
            const heightScale = (height * scale)
            const area = widthScale * heightScale

            // Corners
            let p0 = { x: - widthScale, z: - heightScale }
            let p1 = { x: widthScale, z: - heightScale }
            let p2 = { x: widthScale, z: heightScale }
            let p3 = { x: - widthScale, z: heightScale }

            // Side mid-points
            let p4 = { x: 0, z: - heightScale }
            let p5 = { x: widthScale, z: 0 }
            let p6 = { x: 0, z: heightScale }
            let p7 = { x: - widthScale, z: 0 }

            // Rotate and displace the place boundary
            polygon = []
            for (let index = 0; index < placeMetadata.borderCoordinates.length; index++) {
              const coordinate = placeMetadata.borderCoordinates[index]
              const x = parseFloat(coordinate[0])
              const z = parseFloat(coordinate[2])
              const p = rotatePoint(x, z, 0, 0, rotation)
              polygon.push([p.x + displacementX, p.z + displacementZ])
            }

            // Check if the corners and the mid-points are within the place polygon bounds
            // Good enough (fast) verification that the rectangle is within the polygon, but can be incorrect with jagged shapes
            // tz1and places are mostly shaped somewhere between a rectangle and a triangle
            const inside = pointInPolygon([p0.x, p0.z], polygon) && pointInPolygon([p1.x, p1.z], polygon) && pointInPolygon([p2.x, p2.z], polygon) &&
              pointInPolygon([p3.x, p3.z], polygon) && pointInPolygon([p4.x, p4.z], polygon) && pointInPolygon([p5.x, p5.z], polygon) &&
              pointInPolygon([p6.x, p6.z], polygon) && pointInPolygon([p7.x, p7.z], polygon)

            if (inside) {
              if (!maxRectangle || area > maxRectangle.area) {
                maxRectangle = { area, width, height, centerX, centerZ, scale, displacementX, displacementZ, rotation, p0, p1, p2, p3 }
              }
            }
          }
        }
      }
    }
    if (showRectangularFloor && maxRectangle) {
      const scaledHeight = maxRectangle.height * maxRectangle.scale
      const scaledWidth = maxRectangle.width * maxRectangle.scale
      const shape = [new BABYLON.Vector3(-scaledWidth, 0, -scaledHeight), new BABYLON.Vector3(scaledWidth, 0, -scaledHeight), new BABYLON.Vector3(scaledWidth, 0, scaledHeight), new BABYLON.Vector3(-scaledWidth, 0, scaledHeight)]
      floor = BABYLON.MeshBuilder.ExtrudePolygon('floor', { shape: shape, depth: 0.2, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
      floor.position.y = 0.1
    }
    // Show the adjusted place boundary
    const placeHeight = parseFloat(placeMetadata.buildHeight)
    const shape = []
    for (let index = 0; index < placeMetadata.borderCoordinates.length; index++) {
      const coordinate = placeMetadata.borderCoordinates[index]
      const x = parseFloat(coordinate[0])
      const z = parseFloat(coordinate[2])
      const p = rotatePoint(x, z, 0, 0, maxRectangle.rotation)
      shape.push(new BABYLON.Vector3(p.x + maxRectangle.displacementX, 0, p.z + maxRectangle.displacementZ))
    }
    // https://doc.babylonjs.com/typedoc/classes/BABYLON.Mesh-1#DEFAULTSIDE
    place = BABYLON.MeshBuilder.ExtrudePolygon('polygon', { shape: shape, depth: placeHeight, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
    place.position.y = placeHeight + 0.01

    // Make transparent with edges
    const placeMaterial = new BABYLON.StandardMaterial('mat', scene)
    placeMaterial.alpha = 0.01
    place.material = placeMaterial
    place.enableEdgesRendering()
    place.edgesWidth = 1.0
    place.edgesColor = new BABYLON.Color4(1, 1, 1, 0.5)
    camera.setTarget(place)

    console.log('maxRectangle', maxRectangle)
  }
}

// Make a building mesh with a door and windows using boolean mesh operations
const makeBuilding = () => {
  console.log('makeBuilding')
  removeMesh(buildingMesh)
  buildingMesh = null
  trianglesText.text = DEFAULT_TRIANGLES_TEXT

  if (maxRectangle) {
    try {
      // Configure the various style elements
      let singleDoorStyle = false
      let doubleDoorStyle = false
      let windowsDoorSidesStyle = false
      let windowsOtherSidesStyle = false
      let roundWindowsOtherSidesStyle = false
      let windowsSidesStyle = false
      let flatRoofStyle = false
      let gableRoofStyle = false
      let holeRoofStyle = false
      let alternateFloorOtherSideWindows = false
      let alternateFloorDoorSideWindows = false
      switch (style) {
        case 1:
          singleDoorStyle = true
          windowsDoorSidesStyle = true
          windowsOtherSidesStyle = true
          gableRoofStyle = true
          break
        case 2:
          singleDoorStyle = true
          windowsSidesStyle = true
          flatRoofStyle = true
          break
        case 3:
          doubleDoorStyle = true
          holeRoofStyle = true
          alternateFloorOtherSideWindows = true
          alternateFloorDoorSideWindows = true
          break
        case 4:
          doubleDoorStyle = true
          roundWindowsOtherSidesStyle = true
          flatRoofStyle = true
          alternateFloorDoorSideWindows = true
          break

        default:
          break
      }
      if (storeys) {
        singleDoorStyle = true
        doubleDoorStyle = false
        flatRoofStyle = true
        gableRoofStyle = false
        holeRoofStyle = false
        if (style === 3) {
          holeRoofStyle = true
          flatRoofStyle = false
        }
      }

      const CENTER_WORLD_SPACE = new BABYLON.Vector3(0, 0, 0)
      const FLOOR_HEIGHT = 4
      const WALL_THICKNESS = 0.1
      const WINDOW_PADDING = 0.2

      let floors = Math.trunc(parseFloat(placeMetadata.buildHeight) / (FLOOR_HEIGHT + WALL_THICKNESS))
      console.log('floors', floors)

      const scaledHeight = maxRectangle.height * maxRectangle.scale
      const scaledWidth = maxRectangle.width * maxRectangle.scale

      let floor = 1
      do {
        const floorOffset = (floor - 1) * FLOOR_HEIGHT

        // https://doc.babylonjs.com/divingDeeper/mesh/creation/param/extrude_polygon
        let shape = [new BABYLON.Vector3(-scaledWidth, 0, -scaledHeight), new BABYLON.Vector3(scaledWidth, 0, -scaledHeight), new BABYLON.Vector3(scaledWidth, 0, scaledHeight), new BABYLON.Vector3(-scaledWidth, 0, scaledHeight)]
        const walls = BABYLON.MeshBuilder.ExtrudePolygon('walls', { shape: shape, depth: FLOOR_HEIGHT, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
        walls.position.y = floorOffset + FLOOR_HEIGHT
        walls.material = buildingMaterial

        let depth = FLOOR_HEIGHT
        if (floor > 1) {
          depth = FLOOR_HEIGHT + 4 * WALL_THICKNESS
        }
        // Cut out the inside of the block to make the walls
        const inside = BABYLON.MeshBuilder.ExtrudePolygon('inside', { shape: shape, depth: depth, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
        if (floor === 1) {
          inside.position.y = floorOffset + FLOOR_HEIGHT * 1.2 + WALL_THICKNESS
        } else {
          inside.position.y = floorOffset + FLOOR_HEIGHT + 2 * WALL_THICKNESS
        }
        inside.scaling.x = 0.99
        inside.scaling.z = 0.99
        inside.scaling.y = 1.2

        // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
        let wallsCsg = BABYLON.CSG.FromMesh(walls)
        let insideCsg = BABYLON.CSG.FromMesh(inside)

        let subtractCsg = wallsCsg.subtract(insideCsg)
        let wallsMesh = subtractCsg.toMesh('wallsMesh')
        wallsMesh.material = buildingMaterial

        removeMesh(walls)
        removeMesh(inside)

        const DOOR_HEIGHT = 3
        const DOOR_WIDTH = 2

        if (floor === 1) {
          if (singleDoorStyle) {
            console.log('floor 1, single door style')
            // Create a block to cut out the door
            const createDoor = () => {
              const shape = [new BABYLON.Vector3(-DOOR_WIDTH / 2, 0, scaledHeight - 1), new BABYLON.Vector3(DOOR_WIDTH / 2, 0, scaledHeight - 1), new BABYLON.Vector3(DOOR_WIDTH / 2, 0, scaledHeight + 1), new BABYLON.Vector3(-DOOR_WIDTH / 2, 0, scaledHeight + 1)]
              return BABYLON.MeshBuilder.ExtrudePolygon('door', { shape: shape, depth: DOOR_HEIGHT, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
            }

            if (scaledWidth > (DOOR_WIDTH + 2 * WINDOW_PADDING)) {
              // Create a block to cut out the door
              const door = createDoor()
              door.position.y = floorOffset + DOOR_HEIGHT + WALL_THICKNESS

              // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
              let buildingCsg = BABYLON.CSG.FromMesh(wallsMesh)
              let doorCsg = BABYLON.CSG.FromMesh(door)

              subtractCsg = buildingCsg.subtract(doorCsg)
              let buildingDoorMesh = subtractCsg.toMesh('buildingDoorMesh')

              removeMesh(wallsMesh)
              removeMesh(door)
              wallsMesh = buildingDoorMesh
            } else {
              console.log('no space for door')
            }
          } else if (doubleDoorStyle) {
            console.log('floor 1, double door style')
            // Create a block to cut out the door
            const createDoor = () => {
              const shape = [new BABYLON.Vector3(-DOOR_WIDTH / 2, 0, -scaledHeight - 1), new BABYLON.Vector3(DOOR_WIDTH / 2, 0, -scaledHeight - 1), new BABYLON.Vector3(DOOR_WIDTH / 2, 0, scaledHeight + 1), new BABYLON.Vector3(-DOOR_WIDTH / 2, 0, scaledHeight + 1)]
              return BABYLON.MeshBuilder.ExtrudePolygon('door', { shape: shape, depth: DOOR_HEIGHT, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
            }

            if (scaledWidth > (DOOR_WIDTH + 2 * WINDOW_PADDING)) {
              // Create a block to cut out the door
              const door = createDoor()
              door.position.y = floorOffset + DOOR_HEIGHT + WALL_THICKNESS

              // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
              let buildingCsg = BABYLON.CSG.FromMesh(wallsMesh)
              let doorCsg = BABYLON.CSG.FromMesh(door)

              subtractCsg = buildingCsg.subtract(doorCsg)
              let buildingDoorMesh = subtractCsg.toMesh('buildingDoorMesh')

              removeMesh(wallsMesh)
              removeMesh(door)
              wallsMesh = buildingDoorMesh
              //wallsMesh.material = wallMaterial
            } else {
              console.log('no space for door')
            }
          }
        }

        const WINDOW_HEIGHT = 2
        const WINDOW_WIDTH = 4
        if (windowsDoorSidesStyle) {
          console.log('windows on door side style')
          // Create a block to cut out the windows
          const createWindow = (offset = 0, z0 = -scaledHeight * 2, z1 = scaledHeight * 2) => {
            shape = [new BABYLON.Vector3(-WINDOW_WIDTH / 2 + offset, 0, z0), new BABYLON.Vector3(WINDOW_WIDTH / 2 + offset, 0, z0), new BABYLON.Vector3(WINDOW_WIDTH / 2 + offset, 0, z1), new BABYLON.Vector3(-WINDOW_WIDTH / 2 + offset, 0, z1)]
            return BABYLON.MeshBuilder.ExtrudePolygon('window', { shape: shape, depth: WINDOW_HEIGHT, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
          }

          // Make windows with boolean mesh subtractions on the same sides as the door
          if (2 * scaledWidth > (2 * WINDOW_WIDTH + 4 * WINDOW_PADDING + DOOR_WIDTH)) {
            console.log('2 windows both sides as door')
            // Make 2 windows
            let offset = (scaledWidth - DOOR_WIDTH / 2) / 2 + DOOR_WIDTH / 2
            const window1 = createWindow(offset)
            window1.position.y = floorOffset + FLOOR_HEIGHT / 2 + WINDOW_HEIGHT / 2

            const window2 = createWindow(-offset)
            window2.position.y = floorOffset + FLOOR_HEIGHT / 2 + WINDOW_HEIGHT / 2

            // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
            buildingCsg = BABYLON.CSG.FromMesh(wallsMesh)
            let window1Csg = BABYLON.CSG.FromMesh(window1)
            let window2Csg = BABYLON.CSG.FromMesh(window2)

            subtractCsg = buildingCsg.subtract(window1Csg)
            subtractCsg = subtractCsg.subtract(window2Csg)
            let buildingWindowMesh = subtractCsg.toMesh('buildingWindowMesh')

            subtractCsg = buildingCsg.intersect(window1Csg)
            let window1Mesh = subtractCsg.toMesh('window1Mesh', glassMaterial, scene)
            windows.push(window1Mesh)
            subtractCsg = buildingCsg.intersect(window2Csg)
            let window2Mesh = subtractCsg.toMesh('window2Mesh', glassMaterial, scene)
            windows.push(window2Mesh)

            removeMesh(wallsMesh)
            removeMesh(window1)
            removeMesh(window2)
            wallsMesh = buildingWindowMesh
          } else if (2 * scaledWidth > (2 * WINDOW_WIDTH + 3 * WINDOW_PADDING)) {
            console.log('2 windows across door side')
            // Make 2 windows across the door side
            const padding = (2 * scaledWidth - 2 * WINDOW_WIDTH) / 3
            let offset = padding / 2 + WINDOW_WIDTH / 2
            const window1 = createWindow(offset, -scaledHeight - 1, -scaledHeight + 1)
            window1.position.y = floorOffset + FLOOR_HEIGHT / 2 + WINDOW_HEIGHT / 2

            const window2 = createWindow(-offset, -scaledHeight - 1, -scaledHeight + 1)
            window2.position.y = floorOffset + FLOOR_HEIGHT / 2 + WINDOW_HEIGHT / 2

            // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
            buildingCsg = BABYLON.CSG.FromMesh(wallsMesh)
            let window1Csg = BABYLON.CSG.FromMesh(window1)
            let window2Csg = BABYLON.CSG.FromMesh(window2)

            subtractCsg = buildingCsg.subtract(window1Csg)
            subtractCsg = subtractCsg.subtract(window2Csg)
            let buildingWindowMesh = subtractCsg.toMesh('buildingWindowMesh')

            subtractCsg = buildingCsg.intersect(window1Csg)
            let window1Mesh = subtractCsg.toMesh('window1Mesh', glassMaterial, scene)
            windows.push(window1Mesh)
            subtractCsg = buildingCsg.intersect(window2Csg)
            let window2Mesh = subtractCsg.toMesh('window2Mesh', glassMaterial, scene)
            windows.push(window2Mesh)

            removeMesh(wallsMesh)
            removeMesh(window1)
            removeMesh(window2)
            wallsMesh = buildingWindowMesh
          } else if (2 * scaledWidth > (WINDOW_WIDTH + 2 * WINDOW_PADDING)) {
            console.log('1 windows across door side')
            // Make 1 window accross the door side
            let offset = 0
            const window = createWindow(offset, -scaledHeight - 1, -scaledHeight + 1)
            window.position.y = floorOffset + FLOOR_HEIGHT / 2 + WINDOW_HEIGHT / 2

            // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
            buildingCsg = BABYLON.CSG.FromMesh(wallsMesh)
            let windowCsg = BABYLON.CSG.FromMesh(window)

            subtractCsg = buildingCsg.subtract(windowCsg)
            let buildingWindowMesh = subtractCsg.toMesh('buildingWindowMesh')

            subtractCsg = buildingCsg.intersect(windowCsg)
            let windowMesh = subtractCsg.toMesh('window1Mesh', glassMaterial, scene)
            windows.push(windowMesh)

            removeMesh(wallsMesh)
            removeMesh(window)
            wallsMesh = buildingWindowMesh
          } else {
            console.log('no space for windows around doors')
          }
        }

        if (alternateFloorDoorSideWindows && floor % 2 === 0) {
          console.log('alternate floors, windows on door side')
          if (2 * scaledWidth > (WINDOW_WIDTH + 2 * WINDOW_PADDING)) {
            console.log('2 windows across door side')

            // Create a block to cut out the windows
            const createWindow = (offset = 0, z0 = -scaledHeight * 2, z1 = scaledHeight * 2) => {
              shape = [new BABYLON.Vector3(-WINDOW_WIDTH / 2 + offset, 0, z0), new BABYLON.Vector3(WINDOW_WIDTH / 2 + offset, 0, z0), new BABYLON.Vector3(WINDOW_WIDTH / 2 + offset, 0, z1), new BABYLON.Vector3(-WINDOW_WIDTH / 2 + offset, 0, z1)]
              return BABYLON.MeshBuilder.ExtrudePolygon('window', { shape: shape, depth: WINDOW_HEIGHT, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
            }

            // Make 1 window on the door side
            let offset = 0
            const window = createWindow(offset, scaledHeight - 1, scaledHeight + 1)
            window.position.y = floorOffset + FLOOR_HEIGHT / 2 + WINDOW_HEIGHT / 2

            // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
            buildingCsg = BABYLON.CSG.FromMesh(wallsMesh)
            let windowCsg = BABYLON.CSG.FromMesh(window)

            subtractCsg = buildingCsg.subtract(windowCsg)
            let buildingWindowMesh = subtractCsg.toMesh('buildingWindowMesh')

            subtractCsg = buildingCsg.intersect(windowCsg)
            let windowMesh = subtractCsg.toMesh('window1Mesh', glassMaterial, scene)
            windows.push(windowMesh)

            removeMesh(wallsMesh)
            removeMesh(window)
            wallsMesh = buildingWindowMesh
          } else {
            console.log('no space for windows around doors')
          }
        }

        if (windowsOtherSidesStyle) {
          console.log('windows on other side style')
          // Create a block to cut out the windows
          const createWindow = (offset = 0, z0 = -scaledHeight * 2, z1 = scaledHeight * 2) => {
            //shape = [new BABYLON.Vector3(-WINDOW_WIDTH / 2 + offset, 0, z0), new BABYLON.Vector3(WINDOW_WIDTH / 2 + offset, 0, z0), new BABYLON.Vector3(WINDOW_WIDTH / 2 + offset, 0, z1), new BABYLON.Vector3(-WINDOW_WIDTH / 2 + offset, 0, z1)]
            shape = [new BABYLON.Vector3(-scaledWidth * 2, 0, -WINDOW_WIDTH / 2 + offset), new BABYLON.Vector3(scaledWidth * 2, 0, -WINDOW_WIDTH / 2 + offset), new BABYLON.Vector3(scaledWidth * 2, 0, WINDOW_WIDTH / 2 + offset), new BABYLON.Vector3(-scaledWidth * 2, 0, WINDOW_WIDTH / 2 + offset)]
            return BABYLON.MeshBuilder.ExtrudePolygon('window', { shape: shape, depth: WINDOW_HEIGHT, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
          }
          // Make windows with boolean mesh subtractions on the other sides
          if (2 * scaledHeight > (2 * WINDOW_WIDTH + 3 * WINDOW_PADDING)) {
            // Make 2 windows
            console.log('2 windows on other side')
            const padding = (2 * scaledHeight - 2 * WINDOW_WIDTH) / 3
            let offset = padding / 2 + WINDOW_WIDTH / 2
            const window1 = createWindow(offset)
            window1.position.y = floorOffset + FLOOR_HEIGHT / 2 + WINDOW_HEIGHT / 2

            const window2 = createWindow(-offset)
            window2.position.y = floorOffset + FLOOR_HEIGHT / 2 + WINDOW_HEIGHT / 2

            // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
            buildingCsg = BABYLON.CSG.FromMesh(wallsMesh)
            let window1Csg = BABYLON.CSG.FromMesh(window1)
            let window2Csg = BABYLON.CSG.FromMesh(window2)

            subtractCsg = buildingCsg.subtract(window1Csg)
            subtractCsg = subtractCsg.subtract(window2Csg)
            let buildingWindowMesh = subtractCsg.toMesh('buildingWindowMesh')

            subtractCsg = buildingCsg.intersect(window1Csg)
            let window1Mesh = subtractCsg.toMesh('window1Mesh', glassMaterial, scene)
            windows.push(window1Mesh)
            subtractCsg = buildingCsg.intersect(window2Csg)
            let window2Mesh = subtractCsg.toMesh('window2Mesh', glassMaterial, scene)
            windows.push(window2Mesh)

            removeMesh(wallsMesh)
            removeMesh(window1)
            removeMesh(window2)
            wallsMesh = buildingWindowMesh
          } else if (2 * scaledHeight > (WINDOW_WIDTH + 2 * WINDOW_PADDING)) {
            // Make 1 window
            console.log('1 window on other side')
            const window = createWindow(0)
            window.position.y = floorOffset + FLOOR_HEIGHT / 2 + WINDOW_HEIGHT / 2

            // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
            buildingCsg = BABYLON.CSG.FromMesh(wallsMesh)
            let windowCsg = BABYLON.CSG.FromMesh(window)

            subtractCsg = buildingCsg.subtract(windowCsg)
            let buildingWindowMesh = subtractCsg.toMesh('buildingWindowMesh')

            subtractCsg = buildingCsg.intersect(windowCsg)
            let windowMesh = subtractCsg.toMesh('windowMesh', glassMaterial, scene)
            windows.push(windowMesh)

            removeMesh(wallsMesh)
            removeMesh(window)
            wallsMesh = buildingWindowMesh
          } else {
            console.log('no space for windows')
          }
        }

        if (roundWindowsOtherSidesStyle && floor % 2 !== 0) {
          console.log('round windows on other side style, alternate floors')
          const WINDOW_DIAMETER = 3
          const TESSELLATION = 32
          // https://doc.babylonjs.com/divingDeeper/mesh/creation/set/cylinder
          const createWindow = (tessellation = TESSELLATION) => {
            const cylinder = BABYLON.MeshBuilder.CreateCylinder("cylinder", { height: scaledWidth * 3, diameterTop: WINDOW_DIAMETER, diameterBottom: WINDOW_DIAMETER, tessellation })
            cylinder.rotation.x = Math.PI / 2
            return cylinder
          }
          // Make windows with boolean mesh subtractions on the other sides
          if (2 * scaledHeight > (2 * WINDOW_DIAMETER + 3 * WINDOW_PADDING)) {
            // Make 2 windows
            console.log('2 windows on other side')
            const padding = (2 * scaledHeight - (2 * WINDOW_DIAMETER + 3 * WINDOW_PADDING)) / 3
            let offset = padding / 2 + WINDOW_DIAMETER / 2
            let tesselation = TESSELLATION
            if (storeys && floors > 1) {
              tesselation = TESSELLATION / 4
            }
            const window1 = createWindow(tesselation)
            window1.position.y = floorOffset + FLOOR_HEIGHT / 2
            window1.position.x = offset
            window1.rotateAround(CENTER_WORLD_SPACE, BABYLON.Axis.Y, Math.PI / 2)

            const window2 = createWindow(tesselation)
            window2.position.y = floorOffset + FLOOR_HEIGHT / 2
            window2.position.x = -offset
            window2.rotateAround(CENTER_WORLD_SPACE, BABYLON.Axis.Y, Math.PI / 2)

            // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
            buildingCsg = BABYLON.CSG.FromMesh(wallsMesh)
            let window1Csg = BABYLON.CSG.FromMesh(window1)
            let window2Csg = BABYLON.CSG.FromMesh(window2)

            subtractCsg = buildingCsg.subtract(window1Csg)
            subtractCsg = subtractCsg.subtract(window2Csg)
            let buildingWindowMesh = subtractCsg.toMesh('buildingWindowMesh')

            subtractCsg = buildingCsg.intersect(window1Csg)
            let window1Mesh = subtractCsg.toMesh('window1Mesh', glassMaterial, scene)
            windows.push(window1Mesh)
            subtractCsg = buildingCsg.intersect(window2Csg)
            let window2Mesh = subtractCsg.toMesh('window2Mesh', glassMaterial, scene)
            windows.push(window2Mesh)

            removeMesh(wallsMesh)
            removeMesh(window1)
            removeMesh(window2)
            wallsMesh = buildingWindowMesh
          } else if (2 * scaledHeight > (WINDOW_DIAMETER + 2 * WINDOW_PADDING)) {
            // Make 1 window
            console.log('1 window on other side')
            const window = createWindow()
            window.position.y = floorOffset + FLOOR_HEIGHT / 2
            window.rotateAround(CENTER_WORLD_SPACE, BABYLON.Axis.Y, Math.PI / 2)

            // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
            buildingCsg = BABYLON.CSG.FromMesh(wallsMesh)
            let windowCsg = BABYLON.CSG.FromMesh(window)

            subtractCsg = buildingCsg.subtract(windowCsg)
            let buildingWindowMesh = subtractCsg.toMesh('buildingWindowMesh')

            subtractCsg = buildingCsg.intersect(windowCsg)
            let windowMesh = subtractCsg.toMesh('windowMesh', glassMaterial, scene)
            windows.push(windowMesh)

            removeMesh(wallsMesh)
            removeMesh(window)
            wallsMesh = buildingWindowMesh
          } else {
            console.log('no space for windows')
          }
        }

        if (alternateFloorOtherSideWindows && floor % 2 === 0) {
          console.log('alternate floor other side windows style')
          if (2 * scaledHeight > (WINDOW_WIDTH + 2 * WINDOW_PADDING)) {

            const createWindow = (offset = 0, z0 = -scaledHeight * 2, z1 = scaledHeight * 2) => {
              shape = [new BABYLON.Vector3(-WINDOW_WIDTH / 2 + offset, 0, z0), new BABYLON.Vector3(WINDOW_WIDTH / 2 + offset, 0, z0), new BABYLON.Vector3(WINDOW_WIDTH / 2 + offset, 0, z1), new BABYLON.Vector3(-WINDOW_WIDTH / 2 + offset, 0, z1)]
              return BABYLON.MeshBuilder.ExtrudePolygon('window', { shape: shape, depth: WINDOW_HEIGHT, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
            }

            // Make 1 window
            const window = createWindow(0)
            window.position.y = floorOffset + FLOOR_HEIGHT / 2 + WINDOW_HEIGHT / 2
            window.rotateAround(CENTER_WORLD_SPACE, BABYLON.Axis.Y, Math.PI / 2)

            // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
            buildingCsg = BABYLON.CSG.FromMesh(wallsMesh)
            let windowCsg = BABYLON.CSG.FromMesh(window)

            subtractCsg = buildingCsg.subtract(windowCsg)
            let buildingWindowMesh = subtractCsg.toMesh('buildingWindowMesh')

            subtractCsg = buildingCsg.intersect(windowCsg)
            let windowMesh = subtractCsg.toMesh('windowMesh', glassMaterial, scene)
            windows.push(windowMesh)

            removeMesh(wallsMesh)
            removeMesh(window)
            wallsMesh = buildingWindowMesh
          } else {
            console.log('no space for windows')
          }
        }

        if (windowsSidesStyle) {
          console.log('windows sides style')
          // Create a block to cut out the windows
          const createWindow = (offset = 0, z0 = -scaledHeight * 2, z1 = scaledHeight * 2) => {
            shape = [new BABYLON.Vector3(-scaledWidth / 2 + offset, 0, z0), new BABYLON.Vector3(scaledWidth / 2 + offset, 0, z0), new BABYLON.Vector3(scaledWidth / 2 + offset, 0, z1), new BABYLON.Vector3(-scaledWidth / 2 + offset, 0, z1)]
            return BABYLON.MeshBuilder.ExtrudePolygon('window', { shape: shape, depth: FLOOR_HEIGHT - 1, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
          }

          // Make windows with boolean mesh subtractions on the same sides as the door
          console.log('2 windows both sides')
          // Make 2 side windows
          let offset = DOOR_WIDTH + scaledWidth / 2
          const window1 = createWindow(offset)
          window1.position.y = floorOffset + FLOOR_HEIGHT - 0.5

          const window2 = createWindow(-offset)
          window2.position.y = floorOffset + FLOOR_HEIGHT - 0.5

          // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
          buildingCsg = BABYLON.CSG.FromMesh(wallsMesh)
          let window1Csg = BABYLON.CSG.FromMesh(window1)
          let window2Csg = BABYLON.CSG.FromMesh(window2)

          subtractCsg = buildingCsg.subtract(window1Csg)
          subtractCsg = subtractCsg.subtract(window2Csg)
          let buildingWindowMesh = subtractCsg.toMesh('buildingWindowMesh')

          subtractCsg = buildingCsg.intersect(window1Csg)
          let window1Mesh = subtractCsg.toMesh('window1Mesh', glassMaterial, scene)
          windows.push(window1Mesh)
          subtractCsg = buildingCsg.intersect(window2Csg)
          let window2Mesh = subtractCsg.toMesh('window2Mesh', glassMaterial, scene)
          windows.push(window2Mesh)

          removeMesh(wallsMesh)
          removeMesh(window1)
          removeMesh(window2)
          wallsMesh = buildingWindowMesh
        }

        let stairsMesh
        const STAIRS_WIDTH = 2
        const STAIRS_LENGTH = 4
        // Stairs is a ramp at 45 degrees
        const addStairs = (floorMesh) => {
          if (storeys) {
            const length = FLOOR_HEIGHT / Math.sin(BABYLON.Angle.FromDegrees(45).radians())
            // Create a block to cut out the stairs opening
            const createBlock = () => {
              const shape = [new BABYLON.Vector3(-STAIRS_LENGTH / 2, 0, -scaledHeight + WALL_THICKNESS), new BABYLON.Vector3(STAIRS_LENGTH / 2, 0, -scaledHeight + WALL_THICKNESS), new BABYLON.Vector3(STAIRS_LENGTH / 2, 0, -scaledHeight + DOOR_WIDTH), new BABYLON.Vector3(-STAIRS_LENGTH / 2, 0, -scaledHeight + DOOR_WIDTH)]
              return BABYLON.MeshBuilder.ExtrudePolygon('door', { shape: shape, depth: FLOOR_HEIGHT + WALL_THICKNESS * 2, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
            }

            if (floorMesh && scaledWidth > 2 * STAIRS_WIDTH) {
              // Create a block to cut out the stairs
              const block = createBlock()
              block.position.y = floorOffset + FLOOR_HEIGHT + WALL_THICKNESS

              // https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG
              let roofCsg = BABYLON.CSG.FromMesh(floorMesh)
              let doorCsg = BABYLON.CSG.FromMesh(block)

              subtractCsg = roofCsg.subtract(doorCsg)
              let roofStairsMesh = subtractCsg.toMesh('roofStairsMesh')

              removeMesh(floorMesh)
              removeMesh(block)

              const shape = [new BABYLON.Vector3(-length / 2, 0, -scaledHeight + WALL_THICKNESS), new BABYLON.Vector3(length / 2, 0, -scaledHeight + WALL_THICKNESS), new BABYLON.Vector3(length / 2, 0, -scaledHeight + STAIRS_WIDTH), new BABYLON.Vector3(-length / 2, 0, -scaledHeight + STAIRS_WIDTH)]
              stairsMesh = BABYLON.MeshBuilder.ExtrudePolygon('door', { shape: shape, depth: WALL_THICKNESS, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
              stairsMesh.rotation.z = Math.PI / 4
              stairsMesh.position.y = floorOffset + FLOOR_HEIGHT / 2 + WALL_THICKNESS
              stairsMesh.material = buildingMaterial

              return roofStairsMesh
            } else {
              console.log('no space for stairs')
            }
          }
          return floorMesh
        }

        // Flat roof
        let flatRoofMesh
        if (flatRoofStyle) {
          console.log('flat roof style')
          shape = [new BABYLON.Vector3(-scaledWidth, 0, -scaledHeight), new BABYLON.Vector3(scaledWidth, 0, -scaledHeight), new BABYLON.Vector3(scaledWidth, 0, scaledHeight), new BABYLON.Vector3(-scaledWidth, 0, scaledHeight)]
          // https://doc.babylonjs.com/divingDeeper/mesh/creation/param/extrude_polygon
          flatRoofMesh = BABYLON.MeshBuilder.ExtrudePolygon('polygon', { shape: shape, depth: WALL_THICKNESS, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
          flatRoofMesh.position.y = floorOffset + FLOOR_HEIGHT + WALL_THICKNESS
          flatRoofMesh.scaling.x = 1.01
          flatRoofMesh.scaling.z = 1.01
          flatRoofMesh.material = buildingMaterial
          flatRoofMesh.enableEdgesRendering()
          flatRoofMesh.edgesWidth = 1.0
          flatRoofMesh.edgesColor = new BABYLON.Color4(0, 0, 0, 0.5)

          flatRoofMesh = addStairs(flatRoofMesh)
          flatRoofMesh.material = buildingMaterial
        }

        // Gable style roof
        let gableRoofMesh
        if (gableRoofStyle) {
          console.log('gable roof style')
          // Combine 4 triangle-shaped meshes
          const GABLE_HEIGHT = 1.85
          const angle = Math.atan2(GABLE_HEIGHT, scaledHeight)
          const length = scaledHeight / Math.cos(angle) + WALL_THICKNESS
          shape = [new BABYLON.Vector3(-scaledWidth - WALL_THICKNESS, 0, -length), new BABYLON.Vector3(scaledWidth + WALL_THICKNESS, 0, -length), new BABYLON.Vector3(scaledWidth + WALL_THICKNESS, 0, 0), new BABYLON.Vector3(-scaledWidth - WALL_THICKNESS, 0, 0)]
          let gableRoofMesh1 = BABYLON.MeshBuilder.ExtrudePolygon('polygon', { shape: shape, depth: WALL_THICKNESS, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
          gableRoofMesh1.position.y = floorOffset + FLOOR_HEIGHT + GABLE_HEIGHT
          gableRoofMesh1.material = buildingMaterial
          gableRoofMesh1.rotation.x = -angle

          shape = [new BABYLON.Vector3(scaledWidth + WALL_THICKNESS, 0, length), new BABYLON.Vector3(-scaledWidth - WALL_THICKNESS, 0, length), new BABYLON.Vector3(-scaledWidth - WALL_THICKNESS, 0, 0), new BABYLON.Vector3(scaledWidth + WALL_THICKNESS, 0, 0)]
          let gableRoofMesh2 = BABYLON.MeshBuilder.ExtrudePolygon('polygon', { shape: shape, depth: WALL_THICKNESS, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
          gableRoofMesh2.position.y = floorOffset + FLOOR_HEIGHT + GABLE_HEIGHT
          gableRoofMesh2.material = buildingMaterial
          gableRoofMesh2.rotation.x = angle

          shape = [new BABYLON.Vector3(0, 0, -scaledHeight), new BABYLON.Vector3(GABLE_HEIGHT, 0, 0), new BABYLON.Vector3(0, 0, scaledHeight)]
          let gableRoofMesh3 = BABYLON.MeshBuilder.ExtrudePolygon('polygon', { shape: shape, depth: 2 * scaledWidth - WALL_THICKNESS, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
          gableRoofMesh3.position.y = floorOffset + FLOOR_HEIGHT - WALL_THICKNESS
          gableRoofMesh3.position.x = -scaledWidth + WALL_THICKNESS / 2
          gableRoofMesh3.material = buildingMaterial
          gableRoofMesh3.rotation.z = Math.PI / 2

          gableRoofMesh = BABYLON.Mesh.MergeMeshes([gableRoofMesh1, gableRoofMesh2, gableRoofMesh3], true, true, undefined, false, true)
          gableRoofMesh.material = buildingMaterial
        }

        // Hole style roof
        let holeRoofMesh
        if (holeRoofStyle) {
          console.log('hole roof style')
          shape = [new BABYLON.Vector3(-scaledWidth, 0, -scaledHeight), new BABYLON.Vector3(scaledWidth, 0, -scaledHeight), new BABYLON.Vector3(scaledWidth, 0, scaledHeight), new BABYLON.Vector3(-scaledWidth, 0, scaledHeight)]
          let holeFactor = 2 / 3
          if (storeys) {
            holeFactor = (scaledWidth - 2.5 * STAIRS_WIDTH) / scaledWidth
          }
          // No hole if the factor is too small
          holes = []
          if (holeFactor > 0.1) {
            holes = [[new BABYLON.Vector3(-scaledWidth * holeFactor, 0, -scaledHeight * holeFactor), new BABYLON.Vector3(scaledWidth * holeFactor, 0, -scaledHeight * holeFactor), new BABYLON.Vector3(scaledWidth * holeFactor, 0, scaledHeight * holeFactor), new BABYLON.Vector3(-scaledWidth * holeFactor, 0, scaledHeight * holeFactor)]]
          }
          holeRoofMesh = BABYLON.MeshBuilder.ExtrudePolygon('polygon', { shape: shape, holes: holes, depth: WALL_THICKNESS, sideOrientation: BABYLON.Mesh.DEFAULTSIDE }, scene, earcut)
          holeRoofMesh.position.y = floorOffset + FLOOR_HEIGHT + WALL_THICKNESS
          holeRoofMesh.scaling.x = 1.01
          holeRoofMesh.scaling.z = 1.01
          holeRoofMesh.material = buildingMaterial
          holeRoofMesh.enableEdgesRendering()
          holeRoofMesh.edgesWidth = 1.0
          holeRoofMesh.edgesColor = new BABYLON.Color4(0, 0, 0, 0.5)

          holeRoofMesh = addStairs(holeRoofMesh)
          holeRoofMesh.material = buildingMaterial
        }

        // Join all the meshes into a single mesh, ready for exporting as a .glb
        const meshes = []
        if (wallsMesh) {
          wallsMesh.material = buildingMaterial
          meshes.push(wallsMesh)
        }
        if (flatRoofMesh) {
          meshes.push(flatRoofMesh)
        }
        if (stairsMesh) {
          meshes.push(stairsMesh)
        }
        if (gableRoofMesh) {
          meshes.push(gableRoofMesh)
        }
        if (holeRoofMesh) {
          meshes.push(holeRoofMesh)
        }
        windows.forEach((window, i) => meshes.push(window))

        // https://doc.babylonjs.com/divingDeeper/materials/using/multiMaterials
        //parameters - arrayOfMeshes, disposeSource, allow32BitsIndices, meshSubclass, subdivideWithSubMeshes, multiMultiMaterial
        let currentFloorMesh
        currentFloorMesh = BABYLON.Mesh.MergeMeshes(meshes, true, true, undefined, false, true)
        windows = []

        if (floor === 1) {
          buildingMesh = currentFloorMesh
        } else {
          buildingMesh = BABYLON.Mesh.MergeMeshes([buildingMesh, currentFloorMesh], true, true, undefined, false, true)
        }

        floor++
      } while (storeys && floor <= floors)

      const triangles = Math.round(buildingMesh.getTotalVertices() / 3)
      console.log('triangles', triangles)

      if (trianglesText) {
        trianglesText.text = `Triangles: ${triangles}`
      }
      buildingMesh.name = `building-${placeId}`
    }
    catch (error) {
      console.error(error)
    }
  }
}

// Update the items in the scene
const update = async (id, forced) => {
  let samePlace = true
  if (id) {
    samePlace = placeId === id
    placeId = id
  }
  if (forced || !samePlace) {
    await buildPlaceBounds()
    calculateRectangularFloor()
  }
  makeBuilding()
}

const init = async () => {
  createScene()

  engine.runRenderLoop(function () {
    scene.render()
  })

  window.addEventListener('resize', function () {
    engine.resize()
  })

  buildGui()
  await update(DEFAULT_PLACE_ID, true)
}
init()