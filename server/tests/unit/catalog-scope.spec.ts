import { channelVisibility } from '../../src/services/catalog.service';
import { AuthUser } from '../../src/types';

const member: AuthUser = {
  sub: '4',
  role: 'member',
  parentId: '2',
  username: 'member-a',
  displayName: 'Member A',
  jti: 'test-jti',
};

describe('渠道分级可见性', () => {
  it('达人可见本人和直属团长拥有的渠道', () => {
    expect(channelVisibility(member)).toEqual({
      clause: "(c.owner_id=? OR c.owner_id=? OR EXISTS (SELECT 1 FROM plans p WHERE p.channel_id=c.zhihu_channel_id AND p.owner_id=? AND p.status<>'ended'))",
      bindings: ['4', '2', '4'],
    });
  });
});
