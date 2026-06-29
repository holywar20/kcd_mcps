import { SemanticBrowserServer } from './server'

new SemanticBrowserServer().run().catch( ( err ) => {
	process.stderr.write( `starmind-semantic-browser: fatal: ${ err }\n` )
	process.exit( 1 )
} )
