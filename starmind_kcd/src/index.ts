import { DaedalusServer } from './server';

new DaedalusServer().run().catch( ( err ) => {
	process.stderr.write( `daedalus-mcp: fatal: ${ err }\n` );
	process.exit( 1 );
} );
