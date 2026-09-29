
const assert = require('node:assert/strict')
const cds = require('@sap/cds')


cds.on('loaded', model => {
    for (const name in model.definitions) {
        const elements = model.definitions[name].elements ?? {}
        for (const element in elements) {
            if (elements[element].default?.func) delete elements[element].default
        }
    }
})

const { GET, POST } = cds.test(__dirname + '/..')

const viewer = { auth: { username: 'test-viewer', password: '' } }
const administrator = { auth: { username: 'test-administrator', password: '' } }
const scheduler = { auth: { username: 'test-scheduler', password: '' } }

const presentation = '/odata/v4/presentation'
const retrieval = '/odata/v4/retrieval'

/** Resolves to the HTTP status code of a request, also when it was rejected */
async function statusOf(request) {
    try {
        return (await request).status
    } catch (e) {
        return e.response?.status ?? e.status
    }
}

describe('PresentationService: destructive actions', () => {

    const actions = {
        proxy_downloadMeasuresForToday: {},
        proxy_downloadMeasuresForPastMonths: { fromDate: '202401' },
        proxy_calculateCommercialForecasts: {},
        proxy_resetForecastSettings: {},
        proxy_resetTechnicalAllocations: {},
        proxy_deleteAllData: {},
        proxy_deleteStructureAndTagData: {}
    }

    for (const [action, data] of Object.entries(actions)) {
        it(`rejects a Viewer on ${action} with 403`, async () => {
            assert.equal(await statusOf(POST(`${presentation}/${action}`, data, viewer)), 403)
        })
    }

    it('rejects an anonymous caller on proxy_deleteAllData with 401', async () => {
        assert.equal(await statusOf(POST(`${presentation}/proxy_deleteAllData`, {})), 401)
    })

    it('allows an Administrator on proxy_deleteAllData', async () => {
        assert.ok(await statusOf(POST(`${presentation}/proxy_deleteAllData`, {}, administrator)) < 400)
    })
})

describe('RetrievalService: destructive operations', () => {

    const adminOnly = [
        'downloadMeasuresForToday()',
        'downloadMeasuresForPastMonths(fromDate=202401)',
        'resetForecastSettings()',
        'resetTechnicalAllocations()',
        'calculateCommercialForecasts()',
        `calculateCommercialForecastsForService(serviceId='application')`,
        'deleteAllData()',
        'deleteStructureAndTagData()'
    ]

    for (const operation of adminOnly) {
        it(`rejects a Viewer on ${operation} with 403`, async () => {
            assert.equal(await statusOf(GET(`${retrieval}/${operation}`, viewer)), 403)
        })
    }

    it('rejects the Job Scheduler on deleteAllData() with 403', async () => {
        assert.equal(await statusOf(GET(`${retrieval}/deleteAllData()`, scheduler)), 403)
    })

   
    it('allows the Job Scheduler on downloadMeasuresForToday()', async () => {
        assert.notEqual(await statusOf(GET(`${retrieval}/downloadMeasuresForToday()`, scheduler)), 403)
    })

    it('allows the Job Scheduler on downloadMeasuresForPastMonths()', async () => {
        assert.notEqual(await statusOf(GET(`${retrieval}/downloadMeasuresForPastMonths(fromDate=0)`, scheduler)), 403)
    })
})

describe('PresentationService: destructive actions bound to an entity', () => {

    const service = `BTPServices(reportYearMonth='202401',serviceId='application',retrieved=2024-01-31,interval='Daily')`

    it('rejects a Viewer on deleteBTPService with 403', async () => {
        const url = `${presentation}/${service}/PresentationService.deleteBTPService`
        assert.equal(await statusOf(POST(url, {}, viewer)), 403)
    })

    const metric = `CommercialMetrics(toService_reportYearMonth='202401',toService_serviceId='application',toService_retrieved=2024-01-31,toService_interval='Daily',measureId='memory')`

    it('rejects a Viewer on deleteCommercialMetric with 403', async () => {
        const url = `${presentation}/${metric}/PresentationService.deleteCommercialMetric`
        assert.equal(await statusOf(POST(url, {}, viewer)), 403)
    })

    it('rejects a Viewer on SetForecastSetting with 403', async () => {
        const url = `${presentation}/${metric}/PresentationService.SetForecastSetting`
        assert.equal(await statusOf(POST(url, { method: 'Excluded' }, viewer)), 403)
    })
})

describe('Read access is unaffected', () => {

    it('lets a Viewer read the report', async () => {
        assert.equal(await statusOf(GET(`${presentation}/BTPServices`, viewer)), 200)
    })

    it('lets a Viewer read the alerts', async () => {
        assert.equal(await statusOf(GET('/odata/v4/manage-alerts/Alerts', viewer)), 200)
    })

    it('lets a Viewer simulate an alert', async () => {
        const url = `${retrieval}/testAlert(ID=7b1ba0c0-1f44-4c1f-9d4a-8d3c0e2f2a11,isDraft=false)`
        assert.notEqual(await statusOf(GET(url, viewer)), 403)
    })

    it('rejects an anonymous reader with 401', async () => {
        assert.equal(await statusOf(GET(`${presentation}/BTPServices`)), 401)
    })
})
