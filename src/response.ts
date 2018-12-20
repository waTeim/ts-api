const uuidv1 = require('uuid/v1');

/**
 * General REST processing in case of an error 
 */
function error(e:any,req:any,res:any,next:any) {
  if(res._header == null) {
    if(e.stack) {
      let ref = uuidv1();
      let status = 500;

      if(e.status) status = e.status;
      console.log(`response error ${ref}:`,e.stack);
      res.status(status).send(`<pre>\nerror: ref ${ref}, check logs for further information\n</pre>`);
    }
    else {
      if(e.status != null) res.status(e.status).send({ error:e });
      else next(e);
    }
  }
}

/**
 * REST processing in case of endpoint success
 */
function success(obj:any,req:any,res:any,next:any) {
  if(res._header == null) {
    if(obj == null) console.error("API return null result");
    else {
      if(obj.statusCode != null && obj.body != null) res.status(obj.statusCode).send(obj.body);
      else res.send(obj);
    }
  } 
}

export default { error,success };
