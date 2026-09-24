import { describe, it, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'


process.env.CDS_TYPESCRIPT = 'true'
process.env.CDS_CONFIG = JSON.stringify({
   
    features: { in_memory_db: false },
    requires: {
        db: { kind: 'sqlite', credentials: { url: ':memory:' } },
       
        auth: { users: { viewer: { roles: ['Viewer'] } } }
    }
})



process.env.VCAP_SERVICES = JSON.stringify({
    'uas': [{ name: 'btprc-uas', label: 'uas', credentials: { target_url: 'https://uas.example.com' } }]
})


const cds = require('@sap/cds')


const servedListeners = cds.listeners('served')
require('../srv/server')
for (const listener of cds.listeners('served')) if (!servedListeners.includes(listener)) cds.off('served', listener)

const { GET, POST } = cds.test(path.join(__dirname, '..'))

const viewer = { auth: { username: 'viewer', password: '' } }
const INJECTION = "a'--"

const INJECTION_LITERAL = `'${INJECTION.replace(/'/g, "''")}'`

type PlainSQL = { sql: string, values: unknown }

describe('RetrievalService.calculateCommercialForecastsForService (SEC-CODE-001)', () => {
    let executedSQL: PlainSQL[]
    let dbEvents: string[]
    let dbKind: string

    before(() => {
       
        assert.equal(cds.db.options.kind, 'sqlite')
        assert.equal(cds.db.options.credentials?.url, ':memory:')

        
        const run = cds.db.run
        cds.db.run = function (query: unknown, values?: unknown) {
            if (typeof query === 'string') {
                executedSQL.push({ sql: query, values })
                return Promise.resolve(0)
            }
            return run.call(this, query, values)
        }
       
        cds.db.before('*', (req: any) => { dbEvents.push(req.event) })
    })

    beforeEach(() => {
        executedSQL = []
        dbEvents = []
        dbKind = cds.env.requires.db.kind
    })

    afterEach(() => {
        cds.env.requires.db.kind = dbKind
    })

   
    const forecastSQL = () => executedSQL.filter(x => /prepareCommercialMeasure(Metric|Service)Forecasts/.test(x.sql))

    const assertFormatError = (error: any, value: string) => {
        assert.equal(error?.target, 'serviceId')
        assert.equal(error?.code, '400')
        
        assert.ok(String(error?.message?.value ?? error?.message).includes(`Value "${value}" is not in specified format`), JSON.stringify(error))
    }

    it('records database access (control for the "no SQL executed" assertions)', async () => {
      
        await assert.rejects(async () => { await SELECT.from('db.BTPServices') })
        assert.ok(dbEvents.includes('READ'), `database access not recorded: ${dbEvents}`)
    })

    describe('rejects malformed serviceId with 400 before any SQL is executed', () => {
        beforeEach(() => { cds.env.requires.db.kind = 'hana' })

        const requests: [string, string, string][] = [
            ['a quote character', `/odata/v4/retrieval/calculateCommercialForecastsForService(serviceId=${encodeURIComponent(INJECTION_LITERAL)})`, INJECTION],
            ['a quote character in a parameter alias', `/odata/v4/retrieval/calculateCommercialForecastsForService(serviceId=@p)?@p=${encodeURIComponent(INJECTION_LITERAL)}`, INJECTION],
            ['a quote character via the OData V2 adapter', `/odata/v2/retrieval/calculateCommercialForecastsForService?serviceId=${encodeURIComponent(INJECTION_LITERAL)}`, INJECTION],
            ['an overlong value', `/odata/v4/retrieval/calculateCommercialForecastsForService(serviceId='${'a'.repeat(101)}')`, 'a'.repeat(101)],
        ]
        for (const [name, url, value] of requests) {
            it(`for ${name}`, async () => {
                await assert.rejects(GET(url, viewer), (err: any) => {
                    assert.equal(err.response?.status, 400, `expected 400, got ${err.response?.status}: ${err.message}`)
                    assertFormatError(err.response.data.error, value)
                    return true
                })
                assert.deepEqual(executedSQL, [])
                assert.deepEqual(dbEvents, [])
            })
        }

        it('for a quote character inside a $batch request', async () => {
            const boundary = 'batch_sec_code_001'
            const body = [
                `--${boundary}`,
                'Content-Type: application/http',
                'Content-Transfer-Encoding: binary',
                '',
                `GET calculateCommercialForecastsForService(serviceId=${INJECTION_LITERAL}) HTTP/1.1`,
                '',
                '',
                `--${boundary}--`,
                ''
            ].join('\r\n')
            const { data } = await POST('/odata/v4/retrieval/$batch', body, { ...viewer, headers: { 'Content-Type': `multipart/mixed; boundary=${boundary}` } })

            assert.equal(data.responses.length, 1)
            assert.equal(data.responses[0].status, 400)
            assertFormatError(data.responses[0].body.error, INJECTION)
            assert.deepEqual(executedSQL, [])
            assert.deepEqual(dbEvents, [])
        })

        it('for in-process calls, as made by PresentationService', async () => {
            const srv = await cds.connect.to('RetrievalService')
            const user = new cds.User({ id: 'viewer', roles: ['Viewer'] })
            await assert.rejects(
                srv.tx({ user }, (tx: any) => tx.calculateCommercialForecastsForService({ serviceId: INJECTION })),
                (err: any) => {
                    assert.equal(err.statusCode, 400)
                    assert.equal(err.message, 'ASSERT_FORMAT')
                    assert.equal(err.target, 'serviceId')
                    return true
                }
            )
            assert.deepEqual(executedSQL, [])
            assert.deepEqual(dbEvents, [])
        })
    })

    describe('HANA path binds serviceId as a parameter', () => {
        beforeEach(() => { cds.env.requires.db.kind = 'hana' })

      
        for (const serviceId of ['hana-cloud', 'ERR - no value']) {
            it(`passes '${serviceId}' as a bound value, never in the SQL text`, async () => {
                const { status } = await GET(`/odata/v4/retrieval/calculateCommercialForecastsForService(serviceId='${encodeURIComponent(serviceId)}')`, viewer)
                assert.equal(status, 200)

                const statements = forecastSQL()
                assert.equal(statements.length, 2, `expected the forecast MERGE and UPSERT, got:\n${executedSQL.map(x => x.sql).join('\n')}`)
                const [merge, upsert] = statements
                assert.match(merge.sql, /^\s*MERGE INTO/)
                assert.match(merge.sql, /WHERE \(SERVICEID = \?\)/)
                assert.match(upsert.sql, /^\s*UPSERT/)
                assert.match(upsert.sql, /WHERE \(toMetric_toService_serviceId = \?\)/)
                for (const { sql, values } of statements) {
                    assert.deepEqual(values, [serviceId])
                    assert.ok(!sql.includes(serviceId), `serviceId interpolated into SQL:\n${sql}`)
                }
            })
        }

        for (const [name, url] of [
            ['all services are recalculated', `/odata/v4/retrieval/calculateCommercialForecasts()`],
            ['serviceId is null', `/odata/v4/retrieval/calculateCommercialForecastsForService(serviceId=null)`],
        ]) {
            it(`does not filter or bind anything when ${name}`, async () => {
                const { status } = await GET(url, viewer)
                assert.equal(status, 200)

                const statements = forecastSQL()
                assert.equal(statements.length, 2)
                for (const { sql, values } of statements) {
                    assert.ok(!sql.includes('?'), `unexpected placeholder in:\n${sql}`)
                    assert.ok(!values || (values as unknown[]).length === 0, `unexpected bound values: ${JSON.stringify(values)}`)
                }
            })
        }
    })

    it('retrievalService.ts builds no SQL with a quoted interpolation', () => {
        
        const source = readFileSync(path.join(__dirname, '../srv/retrievalService.ts'), 'utf8')
        const offending = source.split('\n').map((line, i) => `${i + 1}: ${line.trim()}`).filter(line => line.includes("'${"))
        assert.deepEqual(offending, [])
    })
})
