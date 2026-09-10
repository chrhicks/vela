/** Values deliberately serialized into fake Alpaca responses, including malformed fields. */
export type ResponseFixture = undefined | null | boolean | number | string | readonly ResponseFixture[] | { readonly [key: string]: ResponseFixture | undefined }
