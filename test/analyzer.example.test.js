const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

const analyzer = require('../dist/analyzer');

function makeWriteStream(filePath) {
  return fs.createWriteStream(filePath, { mode: 0o644 });
}

function awaitStream(stream) {
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

function removeDir(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return;
  }
  if (fs.rmSync) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } else {
    fs.rmdirSync(dirPath, { recursive: true });
  }
}

describe('analyzer integration using example project', function () {
  this.timeout(20000);

  const exampleRoot = path.resolve(__dirname, '..', 'examples');
  const srcRoot = path.join(exampleRoot, 'src');
  const tmpPrefix = path.join(__dirname, '.tmp-');

  let tmpDir;
  let streams = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(tmpPrefix);
    streams = [];
  });

  afterEach(() => {
    for (const stream of streams) {
      if (stream && !stream.destroyed) {
        stream.destroy();
      }
    }
    removeDir(tmpDir);
    tmpDir = undefined;
  });

  it('generates swagger, routes, and runtime checks for the example controllers', async () => {
    const checkPath = path.join(tmpDir, '__check.js');
    const swaggerPath = path.join(tmpDir, 'swagger.json');
    const redocPath = path.join(tmpDir, 'redoc.html');
    const routesPath = path.join(tmpDir, '__routes.js');

    const checkStream = makeWriteStream(checkPath);
    const swaggerStream = makeWriteStream(swaggerPath);
    const redocStream = makeWriteStream(redocPath);
    const routesStream = makeWriteStream(routesPath);

    streams.push(checkStream, swaggerStream, redocStream, routesStream);

    const env = {
      programArgs: ['node', 'cg'],
      tsInclude: [
        path.join(srcRoot, 'controllers/**/*.ts'),
        path.join(srcRoot, 'Router.ts'),
        path.join(srcRoot, 'types/**/*.d.ts'),
      ],
      rootDir: exampleRoot,
      srcRoot,
      outDir: tmpDir,
      packageName: 'ts-api-examples',
      debug: false,
    };

    let generationError;

    try {
      analyzer.generate(env, checkStream, swaggerStream, redocStream, routesStream);
    } catch (err) {
      generationError = err;
    }

    checkStream.end();
    swaggerStream.end();
    redocStream.end();
    routesStream.end();

    try {
      await Promise.all(streams.map(awaitStream));
    } catch (streamErr) {
      if (!generationError) {
        throw streamErr;
      }
    }

    if (generationError) {
      throw generationError;
    }

    const swaggerDoc = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));
    expect(swaggerDoc.openapi).to.equal('3.0.0');
    expect(swaggerDoc.components).to.have.property('schemas');
    const schemas = swaggerDoc.components.schemas;
    expect(schemas).to.have.property('IUser');

    const userSchema = schemas.IUser;
    expect(userSchema.type).to.equal('object');
    expect(userSchema.properties).to.have.property('id');
    expect(userSchema.properties.id.format).to.equal('uuid');
    expect(userSchema.properties).to.have.property('name');
    expect(userSchema.required).to.include.members(['id', 'name']);

    const listPathKey = Object.keys(swaggerDoc.paths || {}).find((key) => key.includes('/user') && !key.includes('{'));
    expect(listPathKey, 'expected user listing path in swagger doc').to.be.a('string');

    const listOperation = swaggerDoc.paths[listPathKey].get;
    expect(listOperation).to.exist;
    const listResponse = listOperation.responses['200'];
    expect(listResponse).to.exist;
    const listSchema = listResponse.content['application/json'].schema;
    expect(listSchema.type).to.equal('array');
    const listItems = listSchema.items;
    expect(listItems).to.exist;
    if (listItems.$ref) {
      expect(listItems.$ref).to.match(/IUser$/);
    } else {
      expect(listItems.type).to.equal('object');
      expect(listItems.properties).to.have.property('id');
      expect(listItems.properties).to.have.property('name');
    }

    const getPathKey = Object.keys(swaggerDoc.paths || {}).find((key) => key.includes('/user') && key.includes('{userId}'));
    expect(getPathKey, 'expected user lookup path in swagger doc').to.be.a('string');

    const routesSource = fs.readFileSync(routesPath, 'utf8');
    expect(routesSource).to.include('AccountFooModule');
    expect(routesSource).to.include("root.getExpressRouter('AccountFoo').get");
    expect(routesSource).to.include('EndpointCheckBinding');

    const checkSource = fs.readFileSync(checkPath, 'utf8');
    expect(checkSource).to.include('compositeWithDefinitions');
    expect(checkSource).to.include('AccountFoo');

    const redocHtml = fs.readFileSync(redocPath, 'utf8');
    expect(redocHtml.toLowerCase()).to.include('redoc');
  });
});
