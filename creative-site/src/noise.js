export class SimpleNoise {
  constructor() {
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for(let i=0; i<256; i++) p[i] = i;
    for(let i=0; i<256; i++) {
      let r = Math.floor(Math.random() * 256), t = p[i];
      p[i] = p[r]; p[r] = t;
    }
    for(let i=0; i<512; i++) this.perm[i] = p[i & 255];
    this.grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
  }
  dot(g, x, y, z) { return g[0]*x + g[1]*y + g[2]*z; }
  noise(xin, yin, zin) {
    const F3 = 1.0/3.0, S3 = 1.0/6.0;
    let s = (xin+yin+zin)*F3;
    let i = Math.floor(xin+s), j = Math.floor(yin+s), k = Math.floor(zin+s);
    let t = (i+j+k)*S3;
    let X0 = i-t, Y0 = j-t, Z0 = k-t;
    let x0 = xin-X0, y0 = yin-Y0, z0 = zin-Z0;
    let i1, j1, k1, i2, j2, k2;
    if(x0>=y0 && y0>=z0) { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
    else if(x0>=z0 && z0>=y0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
    else if(y0>=x0 && x0>=z0) { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
    else if(y0>=z0 && z0>=x0) { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
    else if(z0>=x0 && x0>=y0) { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
    else { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
    let x1 = x0 - i1 + S3, y1 = y0 - j1 + S3, z1 = z0 - k1 + S3;
    let x2 = x0 - i2 + 2.0*S3, y2 = y0 - j2 + 2.0*S3, z2 = z0 - k2 + 2.0*S3;
    let x3 = x0 - 1.0 + 3.0*S3, y3 = y0 - 1.0 + 3.0*S3, z3 = z0 - 1.0 + 3.0*S3;
    let ii = i & 255, jj = j & 255, kk = k & 255;
    let gi0 = this.perm[ii+this.perm[jj+this.perm[kk]]] % 12;
    let gi1 = this.perm[ii+i1+this.perm[jj+j1+this.perm[kk+k1]]] % 12;
    let gi2 = this.perm[ii+i2+this.perm[jj+j2+this.perm[kk+k2]]] % 12;
    let gi3 = this.perm[ii+1+this.perm[jj+1+this.perm[kk+1]]] % 12;
    let n0, n1, n2, n3;
    let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if(t0<0) n0 = 0.0; else { t0 *= t0; n0 = t0 * t0 * this.dot(this.grad3[gi0], x0, y0, z0); }
    let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if(t1<0) n1 = 0.0; else { t1 *= t1; n1 = t1 * t1 * this.dot(this.grad3[gi1], x1, y1, z1); }
    let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if(t2<0) n2 = 0.0; else { t2 *= t2; n2 = t2 * t2 * this.dot(this.grad3[gi2], x2, y2, z2); }
    let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if(t3<0) n3 = 0.0; else { t3 *= t3; n3 = t3 * t3 * this.dot(this.grad3[gi3], x3, y3, z3); }
    return 32.0*(n0 + n1 + n2 + n3);
  }
}