import express from 'express';
import * as bodyParser from 'body-parser';
import Router from './Router';

// Create Express server
const app = express();

const router = new Router(app);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(router.getExpressRouter());

export default app;

