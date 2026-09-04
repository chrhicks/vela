# Features

Major sections of the application

- **Rigs** - Choose a configured observatory Rig and inspect its live device state
- **Plan** - scheduling sequences to run for a session. A session is an evening of observations/capture
- **Observe** - Prepare the selected Rig from current server state and explicitly connect its supported devices; see [observation](observation/README.md).
- **Library** - Where all the files land, uses preview images as a small abstraction on raw FIT files from a session
- **Process** - Where you do processing of images - stacking basically - to create a master FITS file.
- **Develop** - Develop a master FITS with photo editing tools, background extraction, star extraction, SPCC, color saturation, etc
