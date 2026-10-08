// Editable suggestions only. Categories/tags are created only for selected,
// nonduplicate resources on apply. Markdown heading depth never sets tree depth.
export const headingMappings: Record<string, Record<string, string>> = {
  'node-resources.md': {
    Auth: 'Development/Authentication & Security',
    'CLI Tools': 'Development/CLI Development',
    'Data Validation': 'Development/Validation',
    'Dates & Times': 'Development/Dates & Times',
    'Express Libs': 'Development/Web Frameworks',
    Frameworks: 'Development/Web Frameworks',
    Graphics: 'Development/Image Processing',
    Hosting: 'Infrastructure/Hosting & Deployment',
    HTTP: 'Development/HTTP Clients',
    Logging: 'Development/Logging',
    Markdown: 'Development/Markdown Processing',
    'Misc libraries': 'Development/Utilities',
    'ORMs and Query Builders': 'Databases/ORMs & Query Builders',
    Scheduling: 'Development/Scheduling & Queues',
    Search: 'Development/Search',
    Templating: 'Development/Templates',
    Testing: 'Learning/Architecture & Best Practices',
  },
  'db-resources.md': {
    '': 'Learning/Tutorials & Books',
    DBMS: 'Databases/Database Systems',
    DBAAS: 'Databases/Hosted Databases',
  },
  'software.md': {
    Automation: 'Infrastructure/Automation',
    'CI/CD': 'Infrastructure/CI/CD',
    Diagramming: 'Design/Diagramming & Whiteboards',
    Graphics: 'Design/Graphics Editors',
    Linux: 'Infrastructure/Operating Systems',
    PaaS: 'Infrastructure/Hosting & Deployment',
    'Site Builders': 'Design/Site Builders',
  },
};
const overrides: [RegExp, string, string[]][] = [
  [
    /heidisql|beekeeper|dbeaver|table plus|sqlite browser/i,
    'Databases/Clients & Administration',
    ['desktop app'],
  ],
  [/db diagrams|db designer|schema/i, 'Databases/Schema Design', []],
  [/db fiddle|postgres quer/i, 'Databases/Query Playgrounds', []],
  [/faker\.js/i, 'Development/Utilities', ['library']],
  [/pdfkit|pdfmake/i, 'Development/PDF & Documents', ['library']],
  [
    /socket\.io|sarus|websocket/i,
    'Development/Realtime Communication',
    ['library'],
  ],
  [/^cron(er)?$|^rsmq$/i, 'Development/Scheduling & Queues', ['library']],
  [/auth\.js/i, 'Development/Authentication & Security', ['library']],
  [/iron-icons|^icofx$/i, 'Design/Icons', []],
  [
    /awesome lit/i,
    'Learning/Curated Collections',
    ['Lit', 'curated collection'],
  ],
  [
    /guide|tutorial|starting.*lit|creating.*lit/i,
    'Learning/Tutorials & Books',
    [],
  ],
  [/marp|bedecked|reveal|slide/i, 'Productivity/Presentations', []],
  [
    /marktext|typora|zettlr|markdown monster/i,
    'Productivity/Markdown Editors',
    [],
  ],
  [/obsidian|logseq|joplin|notion/i, 'Productivity/Notes & Knowledge', []],
  [
    /gitkraken|sourcetree|git extensions|github desktop/i,
    'Infrastructure/Development Tooling',
    [],
  ],
  [/slack|discord|mattermost|teams/i, 'Productivity/Communication', []],
  [/trello|asana|jira|clickup/i, 'Productivity/Project Management', []],
  [/toggl|clockify|time.?track/i, 'Productivity/Time Tracking', []],
  [/metabase|superset|power bi/i, 'Productivity/Data Analysis', []],
];

export function suggestMapping(file: string, headings: string[], name: string) {
  if (
    !Object.hasOwn(headingMappings, file) &&
    !['javascript-lit.md', 'webdev-learning.md'].includes(file)
  )
    return { category: '', tags: [], warnings: [] };
  const heading = headings.at(-1) ?? '';
  const mappings = headingMappings[file];
  let category =
    mappings && Object.hasOwn(mappings, heading) ? mappings[heading] : '';
  let tags: string[] = [];
  const warnings: string[] = [];
  if (file === 'javascript-lit.md') {
    category = 'Development/UI Components';
    tags = ['Lit'];
  }
  if (file === 'webdev-learning.md') category = 'Learning/Learning Platforms';
  const override = overrides.find(([pattern]) => pattern.test(name));
  if (override) {
    category = override[1];
    tags = [...new Set([...tags, ...override[2]])];
  }
  if (
    file === 'node-resources.md' &&
    ['Books', 'Frameworks', 'Misc libraries', 'Tools', ''].includes(heading)
  )
    warnings.push(
      'Mixed source group: review classification and resource kind',
    );
  if (file === 'db-resources.md' && heading === 'Tools' && !override)
    warnings.push('Mixed database tools group: choose a category');
  if (
    file === 'software.md' &&
    ['Markdown', 'SCM', 'Teams'].includes(heading) &&
    !override
  )
    warnings.push('Mixed software group: choose a category');
  if (/page\.js/i.test(name)) warnings.push('Review the router category');
  if (file === 'software.md' && name === 'Go')
    warnings.push('Source says Go; consider renaming to GoCD');
  if (
    file === 'node-resources.md' &&
    category.startsWith('Development/') &&
    !warnings.length
  )
    tags.push('Node.js');
  return { category, tags: [...new Set(tags)], warnings };
}
