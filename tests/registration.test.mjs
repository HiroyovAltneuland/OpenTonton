import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePassword,participantSuggestion} from '../lib/registration.ts';
test('generated passwords use 144 random bits and never a shared initial value',()=>{
 const values=Array.from({length:100},generatePassword);
 assert.equal(new Set(values).size,100);
 for(const value of values)assert.match(value,/^[A-Za-z0-9_-]{24}$/);
});
test('participant suggestions retain server high-water mark and skip visible collisions',()=>{
 assert.equal(participantSuggestion([],1),'参加者1');
 assert.equal(participantSuggestion(['参加者1','参加者2'],1),'参加者3');
 assert.equal(participantSuggestion([],9),'参加者9');
 assert.equal(participantSuggestion(['Participant 9'],9,'en'),'Participant 10');
});
