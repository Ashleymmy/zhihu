import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), get: vi.fn() }));
vi.mock('../../src/db', () => ({ db: { query: mocks.query }, rows: vi.fn() }));
vi.mock('../../src/modules/zhihu/zhihu/client', () => ({ zhihuGet: mocks.get }));
import { syncCompositionStatus } from '../../src/modules/zhihu/jobs/syncCompositionStatus';
import { syncTasks } from '../../src/modules/zhihu/jobs/syncCatalog';
import { listPages } from '../../src/modules/zhihu/jobs/listPages';

beforeEach(() => { mocks.query.mockReset(); mocks.get.mockReset(); });
describe('new and legacy upstream synchronization', () => {
  it('syncs a composition beyond the first 100 with the required channel and keyword', async () => {
    mocks.query.mockResolvedValue([{}]).mockResolvedValueOnce([[{id:'local',zhihu_composition_id:'target',channel_id:'channel',keyword:'keyword'}]]);
    mocks.get.mockResolvedValueOnce({ data: Array.from({length:100},(_,i)=>({compositionId:String(i)})) })
      .mockResolvedValueOnce({data:[{compositionId:'target',auditStatus:'rejected',rejectReason:'请补充关键词'}]});
    expect(await syncCompositionStatus()).toEqual({updated:1,total:1});
    expect(mocks.get.mock.calls.map(call=>call[1])).toEqual([
      {channel_id:'channel',keyword:'keyword',offset:0,limit:100},
      {channel_id:'channel',keyword:'keyword',offset:100,limit:100},
    ]);
    expect(mocks.query.mock.calls[1][1]).toEqual([JSON.stringify({auditStatus:'rejected',rejectReason:'请补充关键词'}),'local']);
  });
  it('does not overwrite a review result when the upstream omits it', async () => {
    mocks.query.mockResolvedValueOnce([[{id:'local',zhihu_composition_id:'target',channel_id:'channel',keyword:'keyword'}]]);
    mocks.get.mockResolvedValue({data:[{compositionId:'target'}]});
    expect(await syncCompositionStatus()).toEqual({updated:0,total:1});
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it('groups requests and only updates the matching upstream ID in that channel/keyword', async () => {
    mocks.query.mockResolvedValue([{}]).mockResolvedValueOnce([[
      {id:'1',zhihu_composition_id:'a',channel_id:'channel',keyword:'one'},
      {id:'2',zhihu_composition_id:'b',channel_id:'channel',keyword:'one'},
      {id:'3',zhihu_composition_id:'c',channel_id:'channel2',keyword:'two'},
    ]]);
    mocks.get.mockResolvedValueOnce({data:[{compositionId:'a',auditStatus:'approved'},{compositionId:'c',auditStatus:'rejected'}]})
      .mockResolvedValueOnce({data:[{compositionId:'c',auditStatus:'pending'}]});
    expect(await syncCompositionStatus()).toEqual({updated:2,total:3});
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls.slice(1).map(call=>call[1][1])).toEqual(['1','3']);
  });
  it('reports upstream failures to the job runner', async () => {
    mocks.query.mockResolvedValueOnce([[{id:'1',zhihu_composition_id:'a',channel_id:'channel',keyword:'word'}]]);
    mocks.get.mockRejectedValue(new Error('upstream unavailable'));
    await expect(syncCompositionStatus()).rejects.toThrow('upstream unavailable');
  });
  it('imports task pages after the first 100', async () => {
    mocks.query.mockResolvedValue([{}]);
    mocks.get.mockResolvedValueOnce({data:Array.from({length:100},(_,id)=>({id:String(id),task_name:'Task '+id}))})
      .mockResolvedValueOnce({data:[{id:'100',task_name:'Last task',unit_price:8}]});
    await syncTasks({channelId:'channel'});
    expect(mocks.query).toHaveBeenCalledTimes(101);
    expect(mocks.query.mock.calls[100][1]).toEqual(expect.arrayContaining(['100','Last task',8]));
    expect(mocks.get.mock.calls[1][1]).toMatchObject({offset:100,limit:100});
  });
  it('fails repeated or incomplete pages instead of reporting a complete sync', async () => {
    const collect=async(fetch:()=>Promise<unknown>)=>{for await(const _item of listPages(fetch,item=>String(item.id))) { /* consume */ }};
    const repeated={data:Array.from({length:100},(_,id)=>({id:String(id)}))};
    await expect(collect(async()=>repeated)).rejects.toThrow('分页重复');
    await expect(collect(async()=>({data:[],pagination:{total:1}}))).rejects.toThrow('分页数据不完整');
    await expect(collect(async()=>({unexpected:[]}))).rejects.toThrow('响应格式不正确');
  });
});
