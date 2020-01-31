const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const log = require('../../util/log');
const Cast = require('../../util/cast');

const pahoMQTT = require('paho-mqtt');

const formatMessage = require('format-message');

const blockIconURI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAgY0hSTQAAeiYAAICEAAD6AAAAgOgAAHUwAADqYAAAOpgAABdwnLpRPAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAAvNJREFUOE+d0OlPkgEABnD70trSmVfNo9amM6dl81qzdbhEP5RlmY4vxVY628xCECwOzVDwQDFQSVDxNQFRJy6vFthSBOEVUVDwDjOB8sKjRA3xzfdf6Pn2bM/vy3NMr7e6up50dj5+4IC2Nv4sr26bTZs2215AwJngYL/d3b9m8+bKyqanp7NQWMFilTm9Z6s4nJHm5gm53GIx21fXoKmpban0O4+nEYunLJYDy88DEFzu6JjOyCA6HaV/YOVTr0kkmmFXj9TUqPv6lsxmx49Fu0Lxq+mDrrFROzdrM5scRzUxMRUGY5p9www0PnkoH9oUi42symEud1Sn+720BIHD6/wmPYejmZvdNxrtKSnpMCi7xwOwUolgUTvmGNcf9n+18ngGOl0xNLR+ZJRKK9Aw0cTXLyw4UKiXMEC7Y7CncwiBBcyU5s+CRd34oVJpEwrnS+lKuXzNaIQGBlbZ7NHW1vm0NCwMsN45GE8c+hQW7Y4jhdD4pEG1yq4C9wSCb0VFQzLZxvS0o7NzicVUI5HPYUAOphAD3+ScJWK88Gg3LN6XxM3oARX2Qflebe00nT6s1dpB0MbjTSEQKBjQrlVQr5Tlh9JIAfl4HwLaLRvnS2jA9IFqh0SyVV6uAYBZgwHq6VmOiXkEA+b9esZtbkkMqyCqlHyBgvclZrlnEwLetrMmVWqoRWSiUlUy2Y5KtRcf/wQG9elt3Mci1gOAjmAXRtHJQRSc9yu0B64IwemX7ki/2BgMXV3drHYMSkh4BgMRSSLAdNeltlUmN9JjqynhJQT/3CwvHP4cWUjVKEAIABZp1BGFwp6UlAmDLoZKXDAgzO6te9rKTKwvvs7Mu1iI93l99AEjSSDrd7R3WAso6g7xOhKJgYGkXtf1TtmSK23IFFchgRJEZV4EDX+e+MIjixxe3Mm3fOzeohYOV1cZAgPDYRAaFJkch4qNvHMjBHHV/2aUX3SYZ+Qll8vBJ0JCXcNuRT+Mi0dFRNx1cfGA1/+Rf/BRkwQ/fk0wAAAAAElFTkSuQmCC';

class Scratch3MQTT {

    constructor (runtime) {
        /**
         * Store this for later communication with the Scratch VM runtime.
         * If this extension is running in a sandbox then `runtime` is an async proxy object.
         * @type {Runtime}
         */
        this.runtime = runtime;

        this.reset();
    }

    reset () {
        this._client = null;
        this._connected = false;
        this._message = undefined;
        this._message_queue = [];
        this._previous_message_received = false;
    }

    /**
     * @return {object} This extension's metadata.
     */
    getInfo () {

        return {
            id: 'MQTT',
            name: 'MQTT',
            blockIconURI: blockIconURI,
            blocks: [
                {
                    opcode: 'client',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'mqtt.client',
                        default: 'client host [HOST] port [PORT] clientid [CLIENTID]',
                        description: 'Creates MQTT client'
                    }),
                    arguments: {
                        HOST: {
                            type: ArgumentType.STRING,
                            defaultValue: 'localhost'
                        },
                        PORT: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 8080
                        },
                        CLIENTID: {
                            type: ArgumentType.STRING,
                            defaultValue: 'scratch'
                        }
                    },
                },
                {
                    opcode: 'connect',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'mqtt.connect',
                        default: 'connect',
                        description: 'Connects to MQTT broker'
                    })
                },
                {
                    opcode: 'publish',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'mqtt.publish',
                        default: 'publish topic [TOPIC] message [MESSAGE]',
                        description: 'Publishes a message on a given topic'
                    }),
                    arguments: {
                        TOPIC: {
                            type: ArgumentType.STRING,
                            defaultValue: 'topic'
                        },
                        MESSAGE: {
                            type: ArgumentType.STRING,
                            defaultValue: 'message'
                        }
                    }
                },
                {
                    opcode: 'subscribe',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'mqtt.subscribe',
                        default: 'subscribe [TOPIC]',
                        description: 'Subscribes to a topic'
                    }),
                    arguments: {
                        TOPIC: {
                            type: ArgumentType.STRING,
                            defaultValue: '#'
                        }
                    }
                },
                {
                    opcode: 'next_message',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'mqtt.next_message',
                        default: 'next message',
                        description: 'Next message'
                    })
                },
                {
                    opcode: 'connected',
                    blockType: BlockType.HAT,
                    text: formatMessage({
                        id: 'mqtt.connected',
                        default: 'when connected',
                        description: 'When connected'
                    })
                },
                {
                    opcode: 'message_received',
                    blockType: BlockType.HAT,
                    text: formatMessage({
                        id: 'mqtt.message_received',
                        default: 'when message is received',
                        description: 'When a message is received'
                    })
                },
                {
                    opcode: 'message',
                    blockType: BlockType.REPORTER,
                    text: 'message'
                },
                {
                    opcode: 'topic',
                    blockType: BlockType.REPORTER,
                    text: 'topic'
                }

            ]
        };
    }

    client (args) {
        this.reset();
        const host = Cast.toString(args.HOST);
        const port = Cast.toNumber(args.PORT);
        const clientid = Cast.toString(args.CLIENTID);
        this._client = new pahoMQTT.Client(host, port, clientid);
        this._client.onMessageArrived = this.onMessageArrived;
    }

    connect () {
        if (this._client === undefined) return;
        this._client.connect({
            invocationContext: this,
            onSuccess:this.onConnect,
            onFailure:this.onFailure}
        );
    }

    publish (args) {
        if (!this._connected) return;
        const topic = Cast.toString(args.TOPIC);
        const message = Cast.toString(args.MESSAGE);
        this._client.publish(topic, message);
    }

    subscribe (args) {
        if (this._client === undefined) return;
        const topic = Cast.toString(args.TOPIC);
        this._client.subscribe(topic);
    }

    connected () {
        return this._connected;
    }

    message_received () {
        if (this._previous_message_received) {
            this._previous_message_received = false;
            return false;
        }
        const message_received = this._message_queue.length > 0;
        this._previous_message_received = message_received;
        return message_received;
    }

    topic () {
        if (typeof this._message === 'undefined')
            return '';
        return this._message.destinationName;
    }

    message () {
        if (typeof this._message === 'undefined')
            return '';
        return this._message.payloadString;
    }

    next_message () {
        if (this._message_queue.length > 0) {
            this._message = this._message_queue.shift();
        } else {
            this._message = undefined;
        }
    }

    onMessageArrived (message) {
        log.log("Message received");
        this.connectOptions.invocationContext._message_queue.push(message);
    }

    onConnect() {
        log.log("Connected");
        this.invocationContext._connected = true;
    }

    onFailure () {
        log.log("Connexion failure");
    }
}

module.exports = Scratch3MQTT;
