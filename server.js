import express from 'express'
import cors from 'cors'
import { config as dotenvFlowConfig } from 'dotenv-flow'
dotenvFlowConfig({ silent: false });

class ServerConfig {
    constructor() {
        if(process.env.SERVER_PORT !== undefined)
            this.SERVER_PORT = parseInt(process.env.SERVER_PORT);
        else this.SERVER_PORT = 9053;

        if(process.env.CORS_ALLOW_ORIGIN)
            this.CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN;
        else this.CORS_ALLOW_ORIGIN = "*";

        console.log("SERVER_PORT: " + this.SERVER_PORT)
        console.log("CORS_ALLOW_ORIGIN: " + this.CORS_ALLOW_ORIGIN)
    }
}

const config = new ServerConfig();

export default config

const server = express();

const cors_config = cors({
    origin: config.CORS_ALLOW_ORIGIN,
    methods: [ "POST", "GET" ]
});

server.use(cors_config);

// Set up router
const router = express.Router();

router.use(express.static('dist'))

server.use("/", router);

// start the Express server
server.listen( config.SERVER_PORT, () => {
    console.log( `express server ${process.pid} started at http://localhost:${ config.SERVER_PORT }` );
} );
