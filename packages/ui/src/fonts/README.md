# Inter

These unmodified variable WOFF2 files come from the `web/` directory of the
[official Inter 4.1 release](https://github.com/rsms/inter/releases/tag/v4.1).
The accompanying `LICENSE.txt` is the release's SIL Open Font License 1.1.

The shared UI stylesheet serves normal and italic weights 100–900 locally under
the existing `Inter` family name. Both Vela and the workshop bundle these assets,
so typography does not depend on installed fonts or an external font service.
Do not add a `local()` source: it could select a different installed version.
