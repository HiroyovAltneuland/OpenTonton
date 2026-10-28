import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {csvCell} from '../lib/csv.ts';
import {canonicalNickname} from '../lib/scheduling.ts';
import {stretchPassword,validPasswordProof} from '../lib/password-client.ts';

test('React text interpolation escapes HTML in user text',()=>{
 for(const input of ['<script>alert(1)</script>','<img src=x onerror=1>','</textarea><svg/onload=1>','\" onmouseover=1 < > &']){
  const rendered=renderToStaticMarkup(React.createElement('span',null,input));
  assert(!rendered.includes('<script'));assert(!rendered.includes('<img'));assert(!rendered.includes('<svg'));
  assert(rendered.includes('&lt;'));
 }
});
test('CSV values cannot become formulas or break cells',()=>{
 for(const value of ['=1+1','+SUM(1,1)','-1+2','@SUM(1,1)','  =1+1','\t=1','\r=1','\n=1','\uFEFF=1'])assert(csvCell(value).startsWith('\"\''));
 assert.equal(csvCell('a\",b\nc'),'\"a\"\",b\nc\"');
 assert.equal(csvCell('普通の名前'),'\"普通の名前\"');
 assert(csvCell(canonicalNickname('＝1+1')).startsWith('\"\''));
});
test('SQL and HTML punctuation in passwords becomes a fixed-format credential',async()=>{
 const input="' OR 1=1;--<script>alert(1)</script>";
 const proof=await stretchPassword(input);
 assert(validPasswordProof(proof));assert(!JSON.stringify(proof).includes(input));
 for(const field of ['salt','verifier','scheme'])assert(!validPasswordProof({...proof,[field]:"' OR 1=1;--"}));
 assert(!validPasswordProof({$ne:null}));assert(!validPasswordProof(['x']));
});
