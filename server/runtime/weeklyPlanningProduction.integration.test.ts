import test from 'node:test';
import {prepareWeeklyPlanningProductionFixture} from './weeklyPlanningProduction.fixture.js';
test('actual M1-M3 commands feed default create/start durable orchestrator and retain unmet material proof',async t=>{await prepareWeeklyPlanningProductionFixture(t);});
