export type StatusCodes = 200|202|404;

export type Res<c extends StatusCodes,T>  = {
  body: T;
  statusCode: c;
}
