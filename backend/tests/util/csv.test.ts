import { toCSV } from '../../src/util/csv';

describe('csv utils', () => {
  it('should convert objects to CSV', () => {
    const data = [{ a: 1, b: 2 }, { a: 3, b: 4 }];
    const csv = toCSV(data);
    expect(csv).toBe('a,b\n1,2\n3,4');
  });
});
