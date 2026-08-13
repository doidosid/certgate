# PKI

개발·테스트용 Root CA, Intermediate CA, Gateway·Device Certificate Script를 둔다.

규칙:

- Script와 OpenSSL Config만 Commit
- Private Key, CSR, Certificate 산출물은 Runtime Directory에 생성
- Root CA Key는 Intermediate CA 발급 외 과정에서 사용하지 않음
- Test는 매 실행마다 임시 PKI를 생성
