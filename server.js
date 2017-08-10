const path = require('path')
const cfGraphql = require('cf-graphql')
const express = require('express')
const bodyParser = require('body-parser')
const graphqlHTTP = require('express-graphql')
const contentful = require('contentful')

//let CACHE = {}

const port = process.env.GRAPHQL_PORT || process.env.PORT || 5000
const spaceId = process.env.SPACE_ID
const cdaToken = process.env.CDA_TOKEN
const cmaToken = process.env.CMA_TOKEN

let app

const init = async () => {
	try {
		// Fetch the avaiable locales
		const metas = await fetchSpaceLocaleMetas({ cdaToken, spaceId })

		// Init the server
		app = express()
		app.use(bodyParser.json())
		app.use((req, res, next) => {
			res.header('Access-Control-Allow-Origin', '*')
			res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
			next()
		})
		app.get('/', (req, res, next) => {
			res.json(metas)
		})
		/*app.get('/_drop_cache', (req, res, next) => {
			CACHE = {}
			res.json({ success : true })
		})*/
		app.listen(port)

		// Create a graphwl server for each locale
		await Promise.all(metas.map(({ locale }) => createDataServer({
			spaceId,
			cdaToken,
			cmaToken,
			locale
		})))
	} catch (error) {
		// eslint-disable-next-line no-console
		console.log('Error', error)
	}
}

const fetchSpaceMeta = async ({ cdaToken, spaceId, locale }) => {
	const client = contentful.createClient({
		accessToken : cdaToken,
		space       : spaceId
	})
	const responses = await client.getEntries({ locale, limit : 1000 })
	return responses.items
	.filter(item => item.sys.contentType)
	.filter(item => item.sys.contentType.sys.id === 'settings')
	.pop().fields
}
const fetchSpaceLocaleMetas = async ({ cdaToken, spaceId }) => {
	const meta = await fetchSpaceMeta({ cdaToken, spaceId })
	return Promise.all(meta.availableLocales.map(localeString => {
		const locale = localeString.split('_')[0]
		return fetchSpaceMeta({ cdaToken, spaceId, locale })
	}))
}

const createDataServer = async ({ spaceId, cdaToken, cmaToken, locale }) => {
	const client = cfGraphql.createClient({ spaceId, cdaToken, cmaToken, locale })

	const types = await client.getContentTypes()
	const graph = await cfGraphql.prepareSpaceGraph(types)
	const schema = cfGraphql.createSchema(graph)

	startServer(client, schema, locale)
}

const startServer = (client, schema, locale) => {

	const ui = cfGraphql.helpers.graphiql({
		title : `GraphQL - ${locale}`,
		url   : `/${locale}/graphql`
	})
	app.get(`/${locale}`, (_, res) => res.set(ui.headers).status(ui.statusCode).end(ui.body))
	const opts = { version : false, timeline : false, detailedErrors : false }
	const ext = cfGraphql.helpers.expressGraphqlExtension(client, schema, opts)
	app.use(`/${locale}/graphql`, (req, res, next) => {
		const key = req.method === 'POST' ? JSON.stringify(req.body) : req.originalUrl
		/*if (CACHE[key]) {
			res.json(CACHE[key])
			return
		}*/
		res.tempJson = res.json
		res.json = (data) => {
			//CACHE[key] = data
			res.tempJson(data)
		}
		next()
	})
	app.use(`/${locale}/graphql`, graphqlHTTP(ext))
}

init()
