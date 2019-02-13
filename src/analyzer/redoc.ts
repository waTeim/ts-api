import * as redoc from "../ReDoc";

export function genRedoc(swaggerPath:string,redocFile:NodeJS.ReadWriteStream): void {
  redocFile.write(redoc.src(swaggerPath));
}
