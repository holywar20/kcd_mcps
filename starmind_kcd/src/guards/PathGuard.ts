import { AbstractGuard, GuardError } from './AbstractGuard';
import type { ToolRequest } from './AbstractGuard';
import { MCPUtils } from '../MCPUtils';

/**
 * PathGuard — first concrete guard; three responsibilities:
 *
 * 1. Path jail      — every path param must resolve inside the vault root.
 *                     Prevents path-traversal attacks (../../etc/passwd etc.).
 * 2. Write typing   — on kcd_save, each path's directory-implied type must match
 *                     the artifact's declared frontmatter type.
 * 3. Nonce slot     — always passes in Phase 2 (stdio; OS isolation is the boundary).
 *                     NonceGuard or an extension here activates it for named-pipe transport.
 */
export class PathGuard extends AbstractGuard {

	validate( req: ToolRequest ): void {
		const p = req.params;

		// Jail any recognised path-valued params
		for ( const key of [ 'path', 'from', 'to' ] ) {
			if ( typeof p[key] === 'string' ) this.jail( p[key] as string );
		}

		// kcd_save: jail every write path and check type consistency
		if ( req.tool === 'kcd_save' && p['writes'] !== undefined ) {
			this.validateWriteMap( p['writes'] as Record<string, unknown> );
		}
	}

	/**
	 * Assert that absPath resolves inside the vault root.
	 * Throws GuardError if it resolves to a path outside or equal to the vault root itself.
	 */
	jail( inputPath: string ): void {
		if ( !MCPUtils.vault.isInside( inputPath ) ) {
			throw new GuardError(
				`Path "${inputPath}" is outside the vault ("${MCPUtils.vault.root}")`,
				'PATH_OUTSIDE_VAULT'
			);
		}
	}

	private validateWriteMap( writes: Record<string, unknown> ): void {
		for ( const [ writePath, artifact ] of Object.entries( writes ) ) {
			this.jail( writePath );

			const inferredType  = MCPUtils.vault.classify( writePath );
			const fm            = typeof artifact === 'object' && artifact !== null
				? ( artifact as Record<string, unknown> )['frontmatter']
				: undefined;
			const declaredType  = typeof fm === 'object' && fm !== null
				? String( ( fm as Record<string, unknown> )['type'] ?? '' )
				: '';

			if ( declaredType && inferredType !== 'unknown' && declaredType !== inferredType ) {
				throw new GuardError(
					`Type mismatch at "${writePath}": directory implies "${inferredType}", artifact declares "${declaredType}"`,
					'TYPE_MISMATCH'
				);
			}
		}
	}

	/**
	 * Nonce validation slot — inert in Phase 2 (stdio transport).
	 * Named-pipe transport passes the session nonce here; this method becomes
	 * the single enforcement point without touching any tool handler.
	 */
	validateNonce( _token: string ): boolean {
		return true;
	}
}
