import { Schema, SchemaGetter } from 'effect'

export const alpacaResponse = <S extends Schema.ConstraintDecoder<unknown>>(Value: S) =>
  Schema.Struct({
    Value,
    ClientTransactionID: Schema.Number,
    ServerTransactionID: Schema.Number,
    ErrorNumber: Schema.Number,
    ErrorMessage: Schema.String,
  })

export const boolResponse = alpacaResponse(Schema.Boolean)
export type BoolResponse = typeof boolResponse.Type

export const intResponse = alpacaResponse(Schema.Number)
export type IntResponse = typeof intResponse.Type

export const doubleResponse = alpacaResponse(Schema.Number)
export type DoubleResponse = typeof doubleResponse.Type

export const stringResponse = alpacaResponse(Schema.String)
export type StringResponse = typeof stringResponse.Type

export const stringArrayResponse = alpacaResponse(Schema.Array(Schema.String))
export type StringArrayResponse = typeof stringArrayResponse.Type

export const percentIntResponse = intResponse
export type PercentIntResponse = typeof percentIntResponse.Type

export const percentDoubleResponse = doubleResponse
export type PercentDoubleResponse = typeof percentDoubleResponse.Type

export const connectedResponse = boolResponse
export type ConnectedResponse = typeof connectedResponse.Type

export const descriptionResponse = stringResponse
export type DescriptionResponse = typeof descriptionResponse.Type

export const nameResponse = stringResponse
export type NameResponse = typeof nameResponse.Type

export const driverInfoResponse = stringResponse
export type DriverInfoResponse = typeof driverInfoResponse.Type

export const driverVersionResponse = stringResponse
export type DriverVersionResponse = typeof driverVersionResponse.Type

export const interfaceVersionResponse = intResponse
export type InterfaceVersionResponse = typeof interfaceVersionResponse.Type

export const supportedActionsResponse = stringArrayResponse
export type SupportedActionsResponse = typeof supportedActionsResponse.Type

export const stateValue = Schema.Struct({
  Name: Schema.String,
  Value: Schema.Union([Schema.Boolean, Schema.Number, Schema.String]),
})
export type StateValue = typeof stateValue.Type

export const deviceStateResponse = alpacaResponse(Schema.Array(stateValue))
export type DeviceStateResponse = typeof deviceStateResponse.Type

export const timeStamp = Schema.optionalKey(Schema.String)

export function fromDeviceStateValues<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  const names = new Set(Object.keys(fields))

  return deviceStateResponse.fields.Value.pipe(
    Schema.decodeTo(Schema.Struct(fields), {
      decode: SchemaGetter.transform((values): Schema.Struct.Encoded<Fields> => {
        const record: Record<string, StateValue['Value']> = {}
        for (const { Name, Value } of values) {
          if (names.has(Name)) {
            record[Name] = Value
          }
        }
        return record as Schema.Struct.Encoded<Fields>
      }),
      encode: SchemaGetter.transform((state) =>
        Object.entries(state).flatMap(([Name, Value]) =>
          Value === undefined ? [] : [{ Name, Value }],
        ),
      ),
    }),
  )
}
