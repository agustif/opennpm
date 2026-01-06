import { parsePackageSpec, resolvePackage } from "../lib/registry.js";
import { detectInstalledVersion } from "../lib/version.js";
import {
  fetchSource,
  packageExists,
  listSources,
  readMetadata,
} from "../lib/git.js";
import { ensureGitignore } from "../lib/gitignore.js";
import { ensureTsconfigExclude } from "../lib/tsconfig.js";
import { updateAgentsMd } from "../lib/agents.js";
import {
  getFileModificationPermission,
  setFileModificationPermission,
} from "../lib/settings.js";
import { confirm } from "../lib/prompt.js";
import type { FetchResult } from "../types.js";

export interface FetchOptions {
  cwd?: string;
  /** Override file modification permission: true = allow, false = deny, undefined = prompt */
  allowModifications?: boolean;
}

/**
 * Check if file modifications are allowed
 * Priority:
 * 1. CLI flag override (--modify / --no-modify)
 * 2. Stored preference in settings.json
 * 3. Prompt user
 */
async function checkFileModificationPermission(
  cwd: string,
  cliOverride?: boolean,
): Promise<boolean> {
  // CLI flag takes precedence
  if (cliOverride !== undefined) {
    // Save the preference for future runs
    await setFileModificationPermission(cliOverride, cwd);
    if (cliOverride) {
      console.log("✓ File modifications enabled (--modify)");
    } else {
      console.log("✗ File modifications disabled (--modify=false)");
    }
    return cliOverride;
  }

  // Check settings file for stored preference
  const storedPermission = await getFileModificationPermission(cwd);
  if (storedPermission !== undefined) {
    return storedPermission;
  }

  // Prompt user for permission
  console.log("\nopensrc can update the following files for better integration:");
  console.log("  • .gitignore - add opensrc/ to ignore list");
  console.log("  • tsconfig.json - exclude opensrc/ from compilation");
  console.log("  • AGENTS.md - add source code reference section\n");

  const allowed = await confirm("Allow opensrc to modify these files?");

  // Save the preference to settings.json
  await setFileModificationPermission(allowed, cwd);

  if (allowed) {
    console.log("✓ Permission granted - saved to opensrc/settings.json\n");
  } else {
    console.log("✗ Permission denied - saved to opensrc/settings.json\n");
  }

  return allowed;
}

/**
 * Fetch source code for one or more packages
 */
export async function fetchCommand(
  packages: string[],
  options: FetchOptions = {},
): Promise<FetchResult[]> {
  const cwd = options.cwd || process.cwd();
  const results: FetchResult[] = [];

  // Check if we're allowed to modify files
  const canModifyFiles = await checkFileModificationPermission(cwd, options.allowModifications);

  if (canModifyFiles) {
    // Ensure .gitignore has opensrc/ entry
    const gitignoreUpdated = await ensureGitignore(cwd);
    if (gitignoreUpdated) {
      console.log("✓ Added opensrc/ to .gitignore");
    }

    // Ensure tsconfig.json excludes opensrc/
    const tsconfigUpdated = await ensureTsconfigExclude(cwd);
    if (tsconfigUpdated) {
      console.log("✓ Added opensrc/ to tsconfig.json exclude");
    }
  }

  for (const spec of packages) {
    const { name, version: explicitVersion } = parsePackageSpec(spec);

    console.log(`\nFetching ${name}...`);

    try {
      // Determine target version
      let version = explicitVersion;

      if (!version) {
        // Try to detect from installed packages
        const installedVersion = await detectInstalledVersion(name, cwd);
        if (installedVersion) {
          version = installedVersion;
          console.log(`  → Detected installed version: ${version}`);
        } else {
          console.log(`  → No installed version found, using latest`);
        }
      } else {
        console.log(`  → Using specified version: ${version}`);
      }

      // Check if already exists with the same version
      if (packageExists(name, cwd)) {
        const existingMeta = await readMetadata(name, cwd);
        if (existingMeta && existingMeta.version === version) {
          console.log(`  ✓ Already up to date (${version})`);
          results.push({
            package: name,
            version: existingMeta.version,
            path: existingMeta.repoDirectory
              ? `${cwd}/opensrc/${name}/${existingMeta.repoDirectory}`
              : `${cwd}/opensrc/${name}`,
            success: true,
          });
          continue;
        } else if (existingMeta) {
          console.log(
            `  → Updating ${existingMeta.version} → ${version || "latest"}`,
          );
        }
      }

      // Resolve package info from npm registry
      console.log(`  → Resolving repository...`);
      const resolved = await resolvePackage(name, version);
      console.log(`  → Found: ${resolved.repoUrl}`);

      if (resolved.repoDirectory) {
        console.log(`  → Monorepo path: ${resolved.repoDirectory}`);
      }

      // Fetch the source
      console.log(`  → Cloning at ${resolved.gitTag}...`);
      const result = await fetchSource(resolved, cwd);

      if (result.success) {
        console.log(`  ✓ Saved to ${result.path}`);
        if (result.error) {
          // Warning message (e.g., tag not found)
          console.log(`  ⚠ ${result.error}`);
        }
      } else {
        console.log(`  ✗ Failed: ${result.error}`);
      }

      results.push(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ Error: ${errorMessage}`);
      results.push({
        package: name,
        version: "",
        path: "",
        success: false,
        error: errorMessage,
      });
    }
  }

  // Summary
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\nDone: ${successful} succeeded, ${failed} failed`);

  // Update AGENTS.md with all fetched sources (only if permission granted)
  if (successful > 0 && canModifyFiles) {
    const allSources = await listSources(cwd);
    const agentsUpdated = await updateAgentsMd(allSources, cwd);
    if (agentsUpdated) {
      console.log("✓ Updated AGENTS.md");
    }
  } else if (successful > 0 && !canModifyFiles) {
    // Still update the sources.json index even without modifying AGENTS.md
    const allSources = await listSources(cwd);
    const { updatePackageIndex } = await import("../lib/agents.js");
    await updatePackageIndex(allSources, cwd);
  }

  return results;
}
