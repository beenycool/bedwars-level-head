const str = "foo\nbar";
const res = `${str ? `${str.replace(/\n/g, '\\n')}` : ''}`;
console.log(res);
