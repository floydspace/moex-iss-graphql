import * as cheerio from 'cheerio';

export function parseIssReference(body: string): Reference {
  const $ = cheerio.load(body);
  const path = $('body > h1').text().match(/\/iss\/(.*)/)[1];
  const requiredArgs = parseRequiredArguments(path);
  const blocks: Block[] = $('body > dl > dt').map((_, blockEl) => {
    const blockMeta = $(blockEl).next();
    return {
      name: $(blockEl).text().split(' ')[0],
      description: blockMeta.find('> pre').text().trim(),
      args: blockMeta.find('> dl > dt').map((__, argEl) => {
        const argMeta = $(argEl).next();
        return {
          name: $(argEl).text(),
          description: argMeta.find('> pre').text().trim(),
          type: argMeta.contents()[argMeta.contents().index(argMeta.find(`strong:contains('Type:')`)) + 1].data,
        } as Argument;
      }).get()
    } as Block;
  }).get();
  return { path, requiredArgs, blocks };
}

function parseRequiredArguments(path: string): string[] {
  return (path.match(/\[\w+\]/g) || []).map(arg => arg.match(/\w+/g)[0]);
}

interface Reference {
  path: string;
  requiredArgs: string[];
  blocks: Block[];
}

interface Block {
  name: string;
  description: string;
  args: Argument[];
}

interface Argument {
  name: string;
  description: string;
  type: string;
}
