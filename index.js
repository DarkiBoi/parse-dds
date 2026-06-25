// All values and structures referenced from:
// http://msdn.microsoft.com/en-us/library/bb943991.aspx/
//
// DX10 Cubemap support based on
// https://github.com/dariomanesku/cmft/issues/7#issuecomment-69516844
// https://msdn.microsoft.com/en-us/library/windows/desktop/bb943983(v=vs.85).aspx
// https://github.com/playcanvas/engine/blob/master/src/resources/resources_texture.js

var DDS_MAGIC = 0x20534444
var DDSD_MIPMAPCOUNT = 0x20000

var DDPF_ALPHAPIXELS = 0x1
var DDPF_FOURCC = 0x4
var DDPF_RGB = 0x40

var FOURCC_DXT1 = fourCCToInt32('DXT1')
var FOURCC_DXT3 = fourCCToInt32('DXT3')
var FOURCC_DXT5 = fourCCToInt32('DXT5')
var FOURCC_DX10 = fourCCToInt32('DX10')
var FOURCC_FP32F = 116 // DXGI_FORMAT_R32G32B32A32_FLOAT

var DDSCAPS2_CUBEMAP = 0x200
var D3D10_RESOURCE_DIMENSION_TEXTURE2D = 3
var DXGI_FORMAT_R32G32B32A32_FLOAT = 2

// The header length in 32 bit ints
var headerLengthInt = 31

// Offsets into the header array
var off_magic = 0
var off_size = 1
var off_flags = 2
var off_height = 3
var off_width = 4
var off_mipmapCount = 7
var off_pfFlags = 20
var off_pfFourCC = 21
var off_pfRGBBitCount = 22
var off_pfRBitMask = 23
var off_pfGBitMask = 24
var off_pfBBitMask = 25
var off_pfABitMask = 26
var off_caps2 = 28

module.exports = parseHeaders

function parseHeaders (arrayBuffer) {
  var header = new Int32Array(arrayBuffer, 0, headerLengthInt)

  if (header[off_magic] !== DDS_MAGIC) {
    throw new Error('Invalid magic number in DDS header')
  }

  var pfFlags = header[off_pfFlags]
  var hasFourCC = (pfFlags & DDPF_FOURCC) !== 0
  var isRGB = (pfFlags & DDPF_RGB) !== 0

  if (!hasFourCC && !isRGB) {
    throw new Error('Unsupported format, must contain a FourCC or RGB code')
  }

  var isCompressed = false
  var blockBytes
  var bytesPerPixel
  var format

  if (hasFourCC) {
    var fourCC = header[off_pfFourCC]
    switch (fourCC) {
      case FOURCC_DXT1:
        blockBytes = 8
        format = 'dxt1'
        isCompressed = true
        break
      case FOURCC_DXT3:
        blockBytes = 16
        format = 'dxt3'
        isCompressed = true
        break
      case FOURCC_DXT5:
        blockBytes = 16
        format = 'dxt5'
        isCompressed = true
        break
      case FOURCC_FP32F:
        format = 'rgba32f'
        bytesPerPixel = 16
        break
      case FOURCC_DX10:
        var dx10Header = new Uint32Array(arrayBuffer.slice(128, 128 + 20))
        format = dx10Header[0]
        var resourceDimension = dx10Header[1]

        if (resourceDimension === D3D10_RESOURCE_DIMENSION_TEXTURE2D && format === DXGI_FORMAT_R32G32B32A32_FLOAT) {
          format = 'rgba32f'
          bytesPerPixel = 16
        } else {
          throw new Error('Unsupported DX10 texture format ' + format)
        }
        break
      default:
        throw new Error('Unsupported FourCC code: ' + int32ToFourCC(fourCC))
    }
  } else if (isRGB) {
    var bitCount = header[off_pfRGBBitCount]
    if (bitCount === 32) {
      var rMask = header[off_pfRBitMask]
      var gMask = header[off_pfGBitMask]
      var bMask = header[off_pfBBitMask]
      var aMask = header[off_pfABitMask]

      if (rMask === 0x00FF0000 && gMask === 0x0000FF00 && bMask === 0x000000FF && aMask === (0xFF000000 | 0)) {
        format = 'argb8888'
      } else if (rMask === 0x000000FF && gMask === 0x0000FF00 && bMask === 0x00FF0000 && aMask === (0xFF000000 | 0)) {
        format = 'abgr8888'
      } else {
        format = 'rgba8'
      }
      bytesPerPixel = 4
    } else if (bitCount === 24) {
      format = 'rgb888'
      bytesPerPixel = 3
    } else {
      throw new Error('Unsupported RGB bit count: ' + bitCount)
    }
  }

  var flags = header[off_flags]
  var mipmapCount = 1

  if (flags & DDSD_MIPMAPCOUNT) {
    mipmapCount = Math.max(1, header[off_mipmapCount])
  }

  var cubemap = false
  var caps2 = header[off_caps2]
  if (caps2 & DDSCAPS2_CUBEMAP) {
    cubemap = true
  }

  var width = header[off_width]
  var height = header[off_height]
  var dataOffset = header[off_size] + 4
  var texWidth = width
  var texHeight = height
  var images = []
  var dataLength

  if (hasFourCC && header[off_pfFourCC] === FOURCC_DX10) {
    dataOffset += 20
  }

  if (cubemap) {
    for (var f = 0; f < 6; f++) {
      if (format !== 'rgba32f') {
        throw new Error('Only RGBA32f cubemaps are supported')
      }
      var bpp = 4 * 32 / 8

      width = texWidth
      height = texHeight

      // cubemap should have all mipmap levels defined
      // Math.log2(width) + 1
      var requiredMipLevels = Math.log(width) / Math.log(2) + 1

      for (var i = 0; i < requiredMipLevels; i++) {
        dataLength = width * height * bpp
        images.push({
          offset: dataOffset,
          length: dataLength,
          shape: [ width, height ]
        })
        // Reuse data from the previous level if we are beyond mipmapCount
        // This is hack for CMFT not publishing full mipmap chain https://github.com/dariomanesku/cmft/issues/10
        if (i < mipmapCount) {
          dataOffset += dataLength
        }
        width = Math.max(1, Math.floor(width / 2))
        height = Math.max(1, Math.floor(height / 2))
      }
    }
  } else {
    for (var j = 0; j < mipmapCount; j++) {
      if (isCompressed) {
        dataLength = Math.max(4, width) / 4 * Math.max(4, height) / 4 * blockBytes
      } else {
        dataLength = width * height * bytesPerPixel
      }

      images.push({
        offset: dataOffset,
        length: dataLength,
        shape: [ width, height ]
      })
      dataOffset += dataLength
      width = Math.max(1, Math.floor(width / 2))
      height = Math.max(1, Math.floor(height / 2))
    }
  }

  return {
    shape: [ texWidth, texHeight ],
    images: images,
    format: format,
    flags: flags,
    cubemap: cubemap
  }
}

function fourCCToInt32 (value) {
  return value.charCodeAt(0) +
    (value.charCodeAt(1) << 8) +
    (value.charCodeAt(2) << 16) +
    (value.charCodeAt(3) << 24)
}

function int32ToFourCC (value) {
  return String.fromCharCode(
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff
  )
}
