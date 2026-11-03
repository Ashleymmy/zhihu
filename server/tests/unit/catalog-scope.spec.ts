import { channelVisibility } from '../../src/modules/zhihu/services/catalog.service';
import { AuthUser } from '../../src/types';

const member: AuthUser = {
  sub: '4',
  role: 'creator',
  parentId: '2',
  username: 'member-a',
  displayName: 'Member A',
  jti: 'test-jti',
};

describe('共享渠道目录', () => {
  it('达人可读取当前知乎账号的共享渠道目录，不再按渠道所有人筛选', () => {
    expect(channelVisibility(member)).toEqual({
      clause: '1=1',
      bindings: [],
    });
  });
});
