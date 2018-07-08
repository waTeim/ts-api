function error(e:any,req:any,res:any,next:any) {
  if(res._header == null) {
    
    if(e.stack) {
      if(e.status != null) res.status(e.status).send(`<pre>${e.stack}</pre>`);
      else res.send(`<pre>${e.stack}</pre>`);
    }
    else {
      if(e.status != null) res.status(e.status).send({ error:e });
      else next(e);
    }
  }
}

function success(obj:any,req:any,res:any,next:any) {
  if(res._header == null) {
    if(obj == null) console.error("API return null result");
    else res.send(obj);
  } 
}

export default { error,success };
