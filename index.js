const NODES = [
    'ws://68.183.213.2:46670',
    'ws://68.183.213.2:46671',
    'ws://68.183.213.2:46672',
    'ws://68.183.213.2:46673',
]

const { RpcClient } = require('tendermint')
const { parse } = require('deterministic-json')
const base58check = require('bs58check')
const { createHash } = require('crypto')

const express = require('express')
const cors = require('cors')
const app = express()

const Redis = require('ioredis')
const redis = new Redis({
    port: 6379,
    host: '51.15.40.131',
    family: 4,
    password:
        '+5u+M0EHJWg1KJQZriC0VktF2+pUoWQvkEqX3dq0VscypqmiS9ytVbOMxIlBzy3rs0Eqi2/Ny4o1ogvB', // for testing purposes only, poc
    db: 0,
})

const rpc = RpcClient(NODES[Math.floor(Math.random() * NODES.length)])

const decodeTx = encoded => {
    let tx = Buffer.from(encoded, 'base64').toString('utf-8')

    tx = parse(tx.replace(/^([^{]+){/, '{').replace(/}([^}]+)$/, '}'))

    return tx
}

const hash = (hash, data) =>
    createHash(hash)
        .update(data)
        .digest()

const getAddress = pubkey =>
    base58check.encode(hash('ripemd160', hash('sha256', pubkey)))

rpc.subscribe(["tm.event='Tx'"], data => {
    let tx = decodeTx(data.TxResult.tx)

    if (tx.from) {
        let from = getAddress(Buffer.from(tx.from.pubkey))

        let to = tx.to.address
        let amount = tx.to.amount

        let txObj = JSON.stringify({
            from,
            to,
            amount,
            height: data.TxResult.height,
            type: 'transfer',
            time: new Date().getTime(),
        })

        redis.lpush(from, txObj)
        redis.lpush(to, txObj)
    } else if (tx.kyc) {
        let txObj = JSON.stringify({
            type: 'kyc',
            height: data.TxResult.height,
            time: new Date().getTime(),
        })

        redis.lpush(tx.kyc.whitelist, txObj)
    } else if (tx.alias) {
        let txObj = JSON.stringify({
            type: 'alias',
            height: data.TxResult.height,
            alias: tx.alias.alias,
            time: new Date().getTime(),
        })

        let address = getAddress(Buffer.from(tx.alias.pubkey))

        redis.lpush(address, txObj)
    } else if (tx.faucet) {
        let txObj = JSON.stringify({
            type: 'faucet',
            height: data.TxResult.height,
            time: new Date().getTime(),
        })

        let address = getAddress(Buffer.from(tx.faucet.pubkey))

        redis.lpush(address, txObj)
    }
})

const router = express.Router()

router.get('/txs/:address/:page?', async (req, res) => {
    let page = req.params.page || 0

    let result = await redis.lrange(
        req.params.address,
        page * 15,
        (page + 1) * 15
    )

    res.status(200).send(
        JSON.stringify({
            txs: result,
        })
    )
})

app.use(cors())

app.use('/', router)

app.listen(1234)
