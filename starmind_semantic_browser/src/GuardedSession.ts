import { GuardChain } from './guards'
import type { BrowserSession, DistilledElement, ElementRef, PageSnapshot } from './types'

/**
 * GuardedSession — the origin guard chain wrapped around a BrowserSession.
 *
 * It is itself a BrowserSession (decorator), so the tool surface neither knows nor cares that it's
 * guarded. Before each op it runs the chain against the RESOLVED URL in play: navigate gates its
 * TARGET (refused before the page loads); every other op gates the LIVE current page (so an in-page
 * navigation off the whitelist is caught on the next read or act, not just at navigate time). A
 * GuardError propagates out and the tool handler folds it into a structured result.
 */
export class GuardedSession implements BrowserSession {

	constructor( private inner: BrowserSession, private chain: GuardChain ) {}

	async navigate( url: string ): Promise<PageSnapshot> {
		this.chain.run( { tool: 'navigate', url, act: false } )   // gate the TARGET origin before loading it
		return this.inner.navigate( url )
	}

	async readPage(): Promise<PageSnapshot> {
		await this.guard( 'read_page', false )
		return this.inner.readPage()
	}

	async readRaw(): Promise<string> {
		await this.guard( 'read_raw', false )
		return this.inner.readRaw()
	}

	async scroll( direction: 'down' | 'up' ): Promise<PageSnapshot> {
		await this.guard( 'scroll', false )
		return this.inner.scroll( direction )
	}

	async click( ref: ElementRef ): Promise<DistilledElement> {
		await this.guard( 'click', true )
		return this.inner.click( ref )
	}

	async type( ref: ElementRef, text: string ): Promise<DistilledElement> {
		await this.guard( 'type', true )
		return this.inner.type( ref, text )
	}

	currentUrl(): Promise<string> {
		return this.inner.currentUrl()
	}

	/** Gate an op against the LIVE current page — catches an in-page navigation off the whitelist. */
	private async guard( tool: string, act: boolean ): Promise<void> {
		this.chain.run( { tool, url: await this.inner.currentUrl(), act } )
	}
}
