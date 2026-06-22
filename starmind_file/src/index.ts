import { StarmindFileServer } from './server'

new StarmindFileServer().run().catch( ( err ) => {
	process.stderr.write( `starmind-file: fatal: ${ err }\n` )
	process.exit( 1 )
} )
