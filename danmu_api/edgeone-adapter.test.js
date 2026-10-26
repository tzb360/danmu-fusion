import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildEdgeRequest} from '../node-functions/index.js';

test('EdgeOne catch-all deployment path exists and exports its supported methods',async()=>{
 const config=JSON.parse(fs.readFileSync(new URL('../edgeone.json',import.meta.url),'utf8'));
 for(const rewrite of config.rewrites)assert.ok(fs.existsSync(new URL('..'+rewrite.destination,import.meta.url)));
 const route=await import('../node-functions/[[...path]].js');
 for(const method of ['onRequest','onRequestGet','onRequestPost','onRequestPut','onRequestPatch','onRequestDelete'])assert.equal(typeof route[method],'function');
});
test('EdgeOne GET/HEAD/POST preserve method, body, query and header-based IP without credential logging',async()=>{
 for(const method of ['GET','HEAD','POST']){
  const request=new Request('https://server.example/private-token/api/v2/search/anime?keyword=test',{method,headers:{Authorization:'Bearer private-secret','eo-connecting-ip':'192.0.2.1'},...(method==='POST'?{body:'{"value":1}'}:{})});
  const result=buildEdgeRequest(request);assert.equal(result.request.method,method);assert.equal(result.request.url,request.url);assert.equal(result.clientIp,'192.0.2.1');
  assert.equal(result.request.headers.get('Authorization'),'Bearer private-secret');assert.equal(await result.request.text(),method==='POST'?'{"value":1}':'');
 }
 const source=fs.readFileSync(new URL('../node-functions/index.js',import.meta.url),'utf8');assert.ok(!source.includes('console.'));
});
