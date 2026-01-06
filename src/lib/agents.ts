import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const AGENTS_FILE = 'AGENTS.md';
const SECTION_START = '## Source Code Reference';
const SECTION_MARKER = '<!-- opensrc:start -->';
const SECTION_END_MARKER = '<!-- opensrc:end -->';

/**
 * Generate the opensrc section content for AGENTS.md
 */
function generateSection(packages: Array<{ name: string; version: string; path: string }>): string {
  if (packages.length === 0) {
    return '';
  }

  const lines = [
    '',
    SECTION_START,
    '',
    SECTION_MARKER,
    '',
    'Source code for the following packages is available in `.opensrc/` for deeper understanding of implementation details:',
    '',
  ];

  for (const pkg of packages) {
    lines.push(`- **${pkg.name}@${pkg.version}** - \`.opensrc/${pkg.name}/\``);
  }

  lines.push('');
  lines.push('Use this source code when you need to understand how a package works internally, not just its types/interface.');
  lines.push('');
  lines.push(SECTION_END_MARKER);
  lines.push('');

  return lines.join('\n');
}

/**
 * Check if AGENTS.md has an opensrc section
 */
export async function hasOpensrcSection(cwd: string = process.cwd()): Promise<boolean> {
  const agentsPath = join(cwd, AGENTS_FILE);

  if (!existsSync(agentsPath)) {
    return false;
  }

  try {
    const content = await readFile(agentsPath, 'utf-8');
    return content.includes(SECTION_MARKER);
  } catch {
    return false;
  }
}

/**
 * Update AGENTS.md with current opensrc packages
 */
export async function updateAgentsMd(
  packages: Array<{ name: string; version: string; path: string }>,
  cwd: string = process.cwd()
): Promise<boolean> {
  const agentsPath = join(cwd, AGENTS_FILE);
  const section = generateSection(packages);

  // If no packages, remove the section if it exists
  if (packages.length === 0) {
    if (await hasOpensrcSection(cwd)) {
      return removeOpensrcSection(cwd);
    }
    return false;
  }

  let content = '';

  if (existsSync(agentsPath)) {
    content = await readFile(agentsPath, 'utf-8');

    // Check if section already exists
    if (content.includes(SECTION_MARKER)) {
      // Replace existing section
      const startIdx = content.indexOf(SECTION_START);
      const endIdx = content.indexOf(SECTION_END_MARKER);

      if (startIdx !== -1 && endIdx !== -1) {
        const before = content.slice(0, startIdx).trimEnd();
        const after = content.slice(endIdx + SECTION_END_MARKER.length).trimStart();

        content = before + section + (after ? '\n' + after : '');
        await writeFile(agentsPath, content, 'utf-8');
        return true;
      }
    }

    // Append section
    if (!content.endsWith('\n')) {
      content += '\n';
    }
    content += section;
  } else {
    // Create new file
    content = `# AGENTS.md

Instructions for AI coding agents working with this codebase.
${section}`;
  }

  await writeFile(agentsPath, content, 'utf-8');
  return true;
}

/**
 * Remove the opensrc section from AGENTS.md
 */
export async function removeOpensrcSection(cwd: string = process.cwd()): Promise<boolean> {
  const agentsPath = join(cwd, AGENTS_FILE);

  if (!existsSync(agentsPath)) {
    return false;
  }

  try {
    const content = await readFile(agentsPath, 'utf-8');

    if (!content.includes(SECTION_MARKER)) {
      return false;
    }

    const startIdx = content.indexOf(SECTION_START);
    const endIdx = content.indexOf(SECTION_END_MARKER);

    if (startIdx === -1 || endIdx === -1) {
      return false;
    }

    const before = content.slice(0, startIdx).trimEnd();
    const after = content.slice(endIdx + SECTION_END_MARKER.length).trimStart();

    let newContent = before;
    if (after) {
      newContent += '\n\n' + after;
    }

    // Clean up multiple consecutive newlines
    newContent = newContent.replace(/\n{3,}/g, '\n\n').trim() + '\n';

    await writeFile(agentsPath, newContent, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

