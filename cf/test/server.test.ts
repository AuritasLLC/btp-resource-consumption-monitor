import { describe, it, before, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { inspect } from 'node:util'

const XSUAA_CLIENT_ID = 'sb-btprc-test-client-id'
const XSUAA_CLIENT_SECRET = 'test-xsuaa-client-secret-must-never-be-logged'

// filterServices() reads the bindings from VCAP_SERVICES, so they must be in place before server.ts is loaded
process.env.VCAP_SERVICES = JSON.stringify({
    destination: [{
        name: 'btprc-destination',
        label: 'destination',
        credentials: { uri: 'https://destination.example.com', clientid: 'dest-client', clientsecret: 'dest-secret' }
    }],
    xsuaa: [{
        name: 'btprc-uaa',
        label: 'xsuaa',
        credentials: { url: 'https://uaa.example.com', clientid: XSUAA_CLIENT_ID, clientsecret: XSUAA_CLIENT_SECRET }
    }]
})

// Plain require() so that mock.method() patches the same export objects server.ts uses at call time
const functions = require('../srv/functions')
const { DestinationsOnSubaccountLevelApi } = require('../srv/external/SAP_CP_CF_Connectivity_Destination')
const { createSubaccountDestinationIfNotExist } = require('../srv/server')

describe('createSubaccountDestinationIfNotExist', () => {
    let logged: string[]
    let createdPayloads: any[]
    let existingDestinations: any[]

    before(() => {
        mock.method(functions, 'getServiceDestination', async () => ({ url: 'https://destination.example.com' }))
        mock.method(DestinationsOnSubaccountLevelApi, 'getSubaccountDestinations', () => ({
            execute: async () => existingDestinations
        }))
        mock.method(DestinationsOnSubaccountLevelApi, 'createSubaccountDestinations', (payload: any) => {
            createdPayloads.push(payload)
            return { execute: async () => ({}) }
        })
    })

    beforeEach(() => {
        logged = []
        createdPayloads = []
        existingDestinations = []
        // cds.log writes through the console methods at call time; capture everything, objects included
        for (const level of ['trace', 'debug', 'log', 'info', 'warn', 'error'] as const) {
            mock.method(console, level, (...args: unknown[]) => {
                logged.push(args.map(a => typeof a === 'string' ? a : inspect(a, { depth: null })).join(' '))
            })
        }
    })

    afterEach(() => {
        for (const level of ['trace', 'debug', 'log', 'info', 'warn', 'error'] as const) {
            (console[level] as any).mock?.restore()
        }
    })

    it('creates the destination with the XSUAA credentials but never logs the client secret', async () => {
        await createSubaccountDestinationIfNotExist('https://btprc-srv.example.com')

        assert.equal(createdPayloads.length, 1)
        assert.equal(createdPayloads[0].Name, 'btprc-srv')
        assert.equal(createdPayloads[0].clientId, XSUAA_CLIENT_ID)
        assert.equal(createdPayloads[0].clientSecret, XSUAA_CLIENT_SECRET)

        const output = logged.join('\n')
        assert.match(output, /Subaccount destination "btprc-srv" created\./)
        assert.ok(!output.includes(XSUAA_CLIENT_SECRET), `client secret leaked into log output:\n${output}`)
        assert.ok(!/clientSecret/i.test(output), `destination object leaked into log output:\n${output}`)
    })

    it('does not create or log anything sensitive when the destination already exists', async () => {
        existingDestinations = [{ Name: 'btprc-srv' }]

        await createSubaccountDestinationIfNotExist('https://btprc-srv.example.com')

        assert.equal(createdPayloads.length, 0)
        const output = logged.join('\n')
        assert.match(output, /Subaccount destination "btprc-srv" found/)
        assert.ok(!output.includes(XSUAA_CLIENT_SECRET))
    })
})
