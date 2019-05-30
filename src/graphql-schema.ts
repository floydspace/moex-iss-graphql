import * as cheerio from 'cheerio';
import {
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldConfigMap,
  GraphQLInt,
  GraphQLList,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';
import { keyBy } from 'lodash';
import fetch from 'node-fetch';

const BASE_URL = 'https://iss.moex.com/iss';

const TypeMappings: { [key: string]: GraphQLScalarType } = {
  int32: GraphQLInt,
  string: GraphQLString
};

export async function generateSchema(): Promise<GraphQLSchema> {
  const ref = 5;
  const entity = 'securities';
  const refUrl = `${BASE_URL}/reference/${ref}`;
  const entityUrl = `${BASE_URL}/${entity}.json`;
  const [metaResult, refContent] = await Promise.all([
    fetch(`${entityUrl}?iss.meta=on&iss.data=off`).then(res => res.json()),
    fetch(refUrl).then(res => res.text())
  ]);
  const metadata = metaResult[entity].metadata;
  const docs = keyBy(parseDocs(refContent), d => d.name);

  const query = new GraphQLObjectType({
    name: 'MoexIssQueries',
    fields: () => ({
      [entity]: {
        type: new GraphQLList(new GraphQLObjectType({
          name: 'Security',
          fields: () => Object.keys(metadata).reduce((fields, field) => {
            return {
              ...fields,
              [field]: { type: TypeMappings[metadata[field].type], resolve: parent => parent[field] }
            };
          }, {} as GraphQLFieldConfigMap<void, void>)
        })),
        description: docs[entity].description,
        args: docs[entity].args.reduce((args, arg) => {
          return {
            ...args,
            [arg]: { type: GraphQLString }
          };
        }, {} as GraphQLFieldConfigArgumentMap),
        resolve: async (_, args) => {
          const queryParams = Object.keys(args).map(key => `${key}=${args[key]}`).join('&');
          const url = `${entityUrl}?iss.meta=off&iss.data=on&iss.json=extended${queryParams ? '&' + queryParams : ''}`;
          const response = await fetch(url);
          const result = await response.json();
          return result[1][entity];
        }
      }
    })
  });

  return new GraphQLSchema({ query });
}

function parseDocs(body: string): Block[] {
  const $ = cheerio.load(body);
  const blocks: Block[] = $('body > dl')
    .map((_, el) => {
      return {
        name: $(el).find('> dt').text().split(' ')[0],
        description: $(el).find('> dd > pre').text().trim(),
        args: $(el).find('> dd > dl > dt').map((__, dt) => $(dt).text()).get()
      } as Block;
    })
    .get();
  return blocks;
}

interface Block {
  name: string;
  description: string;
  args: string[];
}
