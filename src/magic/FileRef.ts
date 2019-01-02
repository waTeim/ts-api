export type FileRef<m extends string>  = {
  filename?:string,
  displayName?:string,
  mimeType?:m
};
