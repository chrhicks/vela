import { Schema } from 'effect'

export const alpacaMethodResponse = Schema.Struct({
  ClientTransactionID: Schema.Number,
  ServerTransactionID: Schema.Number,
  ErrorNumber: Schema.Number,
  ErrorMessage: Schema.String,
})

export const alpacaResponse = <S extends Schema.ConstraintDecoder<unknown>>(Value: S) =>
  Schema.Struct({
    Value,
    ...alpacaMethodResponse.fields,
  })

export const boolResponse = alpacaResponse(Schema.Boolean)
export type BoolResponse = typeof boolResponse.Type

export const intResponse = alpacaResponse(Schema.Number)
export type IntResponse = typeof intResponse.Type

export const stringResponse = alpacaResponse(Schema.String)
export type StringResponse = typeof stringResponse.Type

export const stringArrayResponse = alpacaResponse(Schema.Array(Schema.String))
export type StringArrayResponse = typeof stringArrayResponse.Type

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
