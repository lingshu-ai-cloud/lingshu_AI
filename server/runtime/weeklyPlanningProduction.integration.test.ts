import test from 'node:test';
import {prepareWeeklyPlanningProductionFixture} from './weeklyPlanningProduction.fixture.js';
test('actual M1-M3 default binds reference then missing independent person analysis blocks run, queue and paid production',async t=>{await prepareWeeklyPlanningProductionFixture(t);});
