/**
 * Cdp — a dependency-free Chrome DevTools Protocol client over the Node 22 global WebSocket.
 *
 * The whole wire in one small object: {id, method, params} requests correlated by id, plus
 * one-shot waits on protocol events. No third-party deps — the same lean transport the Phase 0
 * spike proved (Node 22 global `WebSocket`). A connector owns one Cdp bound to a single page target.
 */
export class Cdp {

	private nextId  = 1;
	private pending = new Map<number, { resolve: ( v: any ) => void; reject: ( e: Error ) => void }>();
	private waiters = new Map<string, ( ( params: any ) => void )[]>();

	private constructor( private ws: WebSocket ) {
		this.ws.addEventListener( 'message', ( ev: MessageEvent ) => this.receive( String( ev.data ) ) );
	}

	/** Connect to a page-target WebSocket debugger URL. Resolves once the socket is open. */
	static connect( wsUrl: string ): Promise<Cdp> {
		return new Promise( ( resolve, reject ) => {
			const ws = new WebSocket( wsUrl );
			ws.addEventListener( 'open',  () => resolve( new Cdp( ws ) ) );
			ws.addEventListener( 'error', () => reject( new Error( `CDP socket failed to open: ${ wsUrl }` ) ) );
		} );
	}

	/** Send a CDP command and resolve with its `result`. Rejects on a protocol error. */
	send<T = any>( method: string, params: Record<string, unknown> = {} ): Promise<T> {
		const id = this.nextId++;
		return new Promise<T>( ( resolve, reject ) => {
			this.pending.set( id, { resolve, reject } );
			this.ws.send( JSON.stringify( { id, method, params } ) );
		} );
	}

	/** Resolve the next time a protocol event fires. One-shot — re-arm by calling again. */
	once( method: string ): Promise<any> {
		return new Promise( ( resolve ) => {
			const list = this.waiters.get( method ) ?? [];
			list.push( resolve );
			this.waiters.set( method, list );
		} );
	}

	close(): void {
		try { this.ws.close(); } catch { /* already closed */ }
	}

	private receive( raw: string ): void {
		const msg = JSON.parse( raw );
		if ( msg.id && this.pending.has( msg.id ) ) {
			const { resolve, reject } = this.pending.get( msg.id )!;
			this.pending.delete( msg.id );
			msg.error ? reject( new Error( msg.error.message ) ) : resolve( msg.result );
			return;
		}
		if ( msg.method && this.waiters.has( msg.method ) ) {
			const list = this.waiters.get( msg.method )!;
			this.waiters.delete( msg.method );
			for ( const r of list ) r( msg.params );
		}
	}
}
