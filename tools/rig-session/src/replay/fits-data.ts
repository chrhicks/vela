/** The pixel bytes of a FITS file: everything after the header, which ends at the 2880-byte block holding the END card. */
export function fitsData(fits: Buffer, width: number, height: number, bytesPerPixel = 2): Buffer {
  for (let card = 0; card * 80 < fits.length; card++) {
    if (fits.toString('ascii', card * 80, card * 80 + 8).trim() === 'END') {
      const start = Math.ceil(((card + 1) * 80) / 2880) * 2880

      return fits.subarray(start, start + width * height * bytesPerPixel)
    }
  }

  throw new Error('The FITS file has no END card')
}
