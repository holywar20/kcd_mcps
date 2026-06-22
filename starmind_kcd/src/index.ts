import { KcdServer } from './server';

new KcdServer().run().catch( ( err ) => {
	process.stderr.write( `kcd-mcp: fatal: ${ err }\n` );
	process.exit( 1 );
} );
