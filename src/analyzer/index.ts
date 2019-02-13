import * as ts from "typescript";

import { generate } from "./main";

module.exports = {
  generate:function(env,checkFile,swaggerFile,redocFile,routesFile) {
    let src = env.programArgs.slice(2);

    if(src.length == 0) src = env.tsInclude;
    generate(
      src,
      { target:ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS, experimentalDecorators:true },
      env.packageName,
      env.srcRoot,
      checkFile,
      swaggerFile,
      redocFile,
      routesFile,
      env.debug
    );
  }
}
