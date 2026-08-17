# PKI

개발·테스트용 Root CA, Intermediate CA, Gateway·Device Certificate Script를 둔다.

규칙:

- Script와 OpenSSL Config만 Commit
- Private Key, CSR, Certificate 산출물은 Runtime Directory에 생성
- Root CA Key는 Intermediate CA 발급 외 과정에서 사용하지 않음
- Test는 매 실행마다 임시 PKI를 생성

## 현재 상태

Root CA(10년)·Intermediate CA(3년) 초기화 Script까지 구현했다. Device·Gateway Certificate 발급 Script는 아직 없다.

## 실행

~~~bash
./scripts/init-ca.sh                 # pki/runtime(Git 제외)에 CA 생성
./scripts/init-ca.sh /tmp/some-dir   # 임의 출력 경로 지정
./scripts/test_init_ca.sh            # 임시 디렉터리에 생성 후 Chain 검증
~~~

`init-ca.sh`는 Root CA Key로 Intermediate CA만 서명하고 종료한다. 출력물: `root-ca.crt`, `intermediate-ca.key`, `intermediate-ca.crt`, `ca-chain.crt`.
